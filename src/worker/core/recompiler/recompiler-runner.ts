/**
 * recompiler-runner.ts — Runs Ahead-Of-Time recompiled WebAssembly modules
 * inside BottleShip with zero CPU emulation overhead.
 */

import { System } from '../system';
import { Logger, LogCategory } from '../logger';
import { RuntimeBridge } from './runtime-bridge';

export interface RecompilerRunOptions {
    system: System;
    memory: WebAssembly.Memory;
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
        const { system, memory, wasmBytes, stackTop, stackBase = stackTop - 0x100000, entryName = '___tmainCRTStartup', logCalls = false } = options;

        Logger.log(LogCategory.SYSTEM, `[Recompiler] Preparing AOT WebAssembly execution (${wasmBytes.byteLength.toLocaleString()} bytes)...`);

        // Initialize 4KB TEB page at 0x00030000 and PEB at 0x00031000
        const tebBase = 0x00030000;
        const pebBase = 0x00031000;
        const view = new DataView(memory.buffer);
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
            dispatcher: system.process?.dispatcher,
            logCalls,
        });

        // Compile WASM module
        const t0 = performance.now();
        const mod = await WebAssembly.compile(wasmBytes as any);
        const t1 = performance.now();
        Logger.log(LogCategory.SYSTEM, `[Recompiler] Compiled AOT WASM module in ${(t1 - t0).toFixed(2)} ms`);

        // Auto-bind Win32 API imports
        for (const imp of WebAssembly.Module.imports(mod)) {
            if (imp.kind === 'function' && imp.name.startsWith('win32_')) {
                const parts = imp.name.replace(/^win32_/, '').split('_');
                const dll = parts[0];
                const func = parts.slice(1).join('_');
                this.bridge.bindApi(dll, func, 4);
            }
        }

        // Instantiate
        this.instance = await WebAssembly.instantiate(mod, this.bridge.createWasmImports());
        const exports = this.instance.exports as any;
        Logger.log(LogCategory.SYSTEM, `[Recompiler] Module instantiated with ${Object.keys(exports).length} exports.`);

        // Find entry function
        const targetEntry = exports[entryName] || exports.entry;
        if (typeof targetEntry !== 'function') {
            throw new Error(`[Recompiler] Target entry point "${entryName}" not found in exports!`);
        }

        Logger.log(LogCategory.SYSTEM, `[Recompiler] Invoking native entry "${entryName}"(esp=0x${stackTop.toString(16)})...`);

        // Invoke entry point
        try {
            const result = targetEntry(stackTop, 0, 0);
            Logger.log(LogCategory.SYSTEM, `[Recompiler] Entry point returned: 0x${(result >>> 0).toString(16)}`);
            return result;
        } catch (e: any) {
            Logger.error(LogCategory.SYSTEM, `[Recompiler] Execution exception: ${e.message}`);
            throw e;
        }
    }
}
