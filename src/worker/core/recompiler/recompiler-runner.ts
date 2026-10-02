/**
 * recompiler-runner.ts — Runs Ahead-Of-Time recompiled WebAssembly modules
 * inside BottleShip with zero CPU emulation overhead.
 */

import { System } from '../system';
import { Logger, LogCategory } from '../logger';
import { RuntimeBridge } from './runtime-bridge';
import { parseAotApiImport } from './import-name';

export interface RecompilerRunOptions {
    system: System;
    memory: WebAssembly.Memory;
    memoryOffset?: number;
    memoryLength?: number;
    wasmBytes: ArrayBuffer | Uint8Array;
    stackTop: number;
    stackBase?: number;
    entryName?: string;
    logCalls?: boolean;
}

export class RecompilerRunner {
    private instance: WebAssembly.Instance | null = null;
    private bridge: RuntimeBridge | null = null;

    static async tryFetchRecompiledWasm(name: string): Promise<ArrayBuffer | null> {
        try {
            const url = `/${name}`;
            const resp = await fetch(url);
            if (resp.ok) {
                Logger.log(LogCategory.SYSTEM, `[Recompiler] Found AOT module at ${url} (${resp.headers.get('content-length') || 'unknown'} bytes)`);
                return await resp.arrayBuffer();
            }
        } catch {
            // Not found or network error
        }
        return null;
    }

    async start(options: RecompilerRunOptions): Promise<any> {
        const { system, memory, wasmBytes, stackTop, stackBase = stackTop - 0x100000, entryName = '___tmainCRTStartup', logCalls = false, memoryOffset = 0, memoryLength } = options;
        Logger.log(LogCategory.SYSTEM, `[Recompiler] Guest RAM offset=0x${memoryOffset.toString(16)}, length=${memoryLength ?? memory.buffer.byteLength}`);

        Logger.log(LogCategory.SYSTEM, `[Recompiler] Preparing AOT WebAssembly execution (${wasmBytes.byteLength.toLocaleString()} bytes)...`);

        // Initialize 4KB TEB page at 0x00030000 and PEB at 0x00031000
        const tebBase = 0x00030000;
        const pebBase = 0x00031000;
        const view = new DataView(memory.buffer, memoryOffset, memoryLength);
        view.setUint32(tebBase + 0x00, 0xffffffff, true); // ExceptionList
        view.setUint32(tebBase + 0x04, stackTop, true);   // StackBase
        view.setUint32(tebBase + 0x08, stackBase, true);  // StackLimit
        view.setUint32(tebBase + 0x18, tebBase, true);    // Self
        view.setUint32(tebBase + 0x20, 1234, true);       // PID
        view.setUint32(tebBase + 0x24, 42, true);         // TID
        view.setUint32(tebBase + 0x30, pebBase, true);    // PEB

        view.setUint8(pebBase + 0x02, 0);                 // BeingDebugged = 0
        const imageBase = system.process?.moduleRegistry?.getMainExecutableBase() ?? 0x00400000;
        view.setUint32(pebBase + 0x08, imageBase, true);  // ImageBaseAddress

        // Create RuntimeBridge connected to the process dispatcher
        this.bridge = new RuntimeBridge({
            memory,
            enableAsync: typeof (WebAssembly as any).Suspending === 'function',
            memoryOffset,
            memoryLength,
            dispatcher: system.process?.dispatcher,
            logCalls,
        });

        // Parse in-memory PE Import Directory at imageBase to bind all IAT entries
        const lfanew = view.getUint32(imageBase + 0x3c, true);
        const optHeaderOffset = imageBase + lfanew + 24;
        const importDirRVA = view.getUint32(optHeaderOffset + 104, true);
        const importDirSize = view.getUint32(optHeaderOffset + 108, true);

        const importDllNames = new Set<string>();
        if (importDirRVA && importDirSize) {
            let descOffset = imageBase + importDirRVA;
            const descEnd = descOffset + importDirSize;
            const memBytes = new Uint8Array(memory.buffer, memoryOffset, memoryLength);

            const readAnsi = (addr: number): string => {
                let str = '';
                for (let i = addr; i < memBytes.length && memBytes[i] !== 0; i++) {
                    str += String.fromCharCode(memBytes[i]);
                }
                return str;
            };

            while (descOffset + 20 <= descEnd) {
                const iltRVA = view.getUint32(descOffset, true);
                const nameRVA = view.getUint32(descOffset + 12, true);
                const iatRVA = view.getUint32(descOffset + 16, true);
                if (!nameRVA || !iatRVA) break;

                const dllName = readAnsi(imageBase + nameRVA);
                importDllNames.add(dllName);
                const thunkRVA = iltRVA || iatRVA;
                let i = 0;

                while (true) {
                    const thunkVal = view.getUint32(imageBase + thunkRVA + i * 4, true);
                    const iatSlot = imageBase + iatRVA + i * 4;
                    if (thunkVal === 0) break;

                    let funcName = '';
                    if ((thunkVal & 0x80000000) === 0) {
                        funcName = readAnsi(imageBase + thunkVal + 2);
                    } else {
                        funcName = `ord_${thunkVal & 0xffff}`;
                    }

                    if (funcName) {
                        this.bridge.registerIatEntry(iatSlot, dllName, funcName);
                        // Populate IAT slot in memory with its own address for indirect calls
                        view.setUint32(iatSlot, iatSlot, true);
                    }
                    i++;
                }
                descOffset += 20;
            }
        }

        // Compile WASM module
        const t0 = performance.now();
        const mod = await WebAssembly.compile(wasmBytes as any);
        const t1 = performance.now();
        Logger.log(LogCategory.SYSTEM, `[Recompiler] Compiled AOT WASM module in ${(t1 - t0).toFixed(2)} ms`);

        // Auto-bind Win32 API imports
        for (const imp of WebAssembly.Module.imports(mod)) {
            if (imp.kind === 'function' && imp.name.startsWith('win32_')) {
                const {dll, func} = parseAotApiImport(imp.name, importDllNames);
                this.bridge.bindApi(dll, func, 4);
            }
        }

        // Instantiate
        this.instance = await WebAssembly.instantiate(mod, this.bridge.createWasmImports());
        const exports = this.instance.exports as any;
        if (exports.guest_memory_base instanceof WebAssembly.Global) {
            exports.guest_memory_base.value = memoryOffset;
        } else if (memoryOffset !== 0) {
            throw new Error('AOT module lacks guest_memory_base; rebuild before using offset guest RAM');
        }
        this.bridge.registerExports(exports);
        Logger.log(LogCategory.SYSTEM, `[Recompiler] Module instantiated with ${Object.keys(exports).length} exports.`);

        // Initialize PE security cookie via entry() if available
        if (typeof exports.entry === 'function') {
            Logger.log(LogCategory.SYSTEM, `[Recompiler] Initializing PE security cookie via entry()...`);
            try {
                if (typeof (WebAssembly as any).promising === 'function') await (WebAssembly as any).promising(exports.entry)(stackTop, 0, 0);
                else exports.entry(stackTop, 0, 0);
            } catch (error) {
                if (exports.aot_debug_pc) Logger.error(LogCategory.SYSTEM, `[Recompiler] Last debug block: 0x${(exports.aot_debug_pc.value >>> 0).toString(16)}`);
                if (exports.aot_debug_fuel?.value === 0) {
                    Logger.error(LogCategory.SYSTEM, `[Recompiler] Debug block budget exhausted at 0x${(exports.aot_debug_pc.value >>> 0).toString(16)}`);
                }
                throw error;
            }
        }

        // Find entry function
        const targetEntry = exports[entryName] || exports.___tmainCRTStartup || exports.entry;
        if (typeof targetEntry !== 'function') {
            throw new Error(`[Recompiler] Target entry point "${entryName}" not found in exports!`);
        }

        Logger.log(LogCategory.SYSTEM, `[Recompiler] Invoking native entry "${entryName}"(esp=0x${stackTop.toString(16)})...`);

        // Invoke entry point
        try {
            const result = typeof (WebAssembly as any).promising === 'function'
                ? await (WebAssembly as any).promising(targetEntry)(stackTop, 0, 0)
                : targetEntry(stackTop, 0, 0);
            Logger.log(LogCategory.SYSTEM, `[Recompiler] Entry point returned: 0x${(result >>> 0).toString(16)}`);
            return result;
        } catch (e: any) {
            if (exports.aot_debug_pc) Logger.error(LogCategory.SYSTEM, `[Recompiler] Last debug block: 0x${(exports.aot_debug_pc.value >>> 0).toString(16)}`);
                if (exports.aot_debug_fuel?.value === 0) {
                Logger.error(LogCategory.SYSTEM, `[Recompiler] Debug block budget exhausted at 0x${(exports.aot_debug_pc.value >>> 0).toString(16)}`);
            }
            Logger.error(LogCategory.SYSTEM, `[Recompiler] Execution exception: ${e.message}`);
            throw e;
        }
    }
}
