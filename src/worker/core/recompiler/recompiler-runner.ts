/**
 * recompiler-runner.ts — Runs Ahead-Of-Time recompiled WebAssembly modules
 * inside BottleShip with zero CPU emulation overhead.
 */

import { System } from '../system';
import { Logger, LogCategory } from '../logger';
import { RuntimeBridge } from './runtime-bridge';
import { parseAotApiImport } from './import-name';
import type { DllInitEntry } from '../pe-loader';

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
    dllInits?: DllInitEntry[];
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
        const { system, memory, wasmBytes, stackTop, stackBase = stackTop - 0x100000, entryName = 'entry', logCalls = false, memoryOffset = 0, memoryLength } = options;
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

        const nativeApiResolver = (dll: string, func: string): number | undefined => {
            const registry = system.process?.moduleRegistry;
            const module = registry?.getByName?.(dll);
            return registry && module?.isRealDll ? registry.getExportAddress(dll, func) : undefined;
        };

        // Create RuntimeBridge connected to the process dispatcher
        this.bridge = new RuntimeBridge({
            memory,
            enableAsync: typeof (WebAssembly as any).Suspending === 'function',
            memoryOffset,
            memoryLength,
            dispatcher: system.process?.dispatcher,
            logCalls,
            nativeApiResolver,
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
                        const nativeAddress = nativeApiResolver(dllName, funcName);
                        this.bridge.registerIatEntry(iatSlot, dllName, funcName);
                        // Populate IAT slot in memory with its own address for indirect calls
                        view.setUint32(iatSlot, nativeAddress ?? iatSlot, true);
                    }
                    i++;
                }
                descOffset += 20;
            }
        }

        // Native modules introduce additional HLE imports (e.g. msvcrt).
        // Collect their actual PE import DLL names for unambiguous WASM name parsing.
        for (const loaded of system.process?.moduleRegistry?.getAllModules?.() ?? []) {
            if (!loaded.isRealDll) continue;
            const base = loaded.baseAddress;
            const optional = base + view.getUint32(base + 0x3c, true) + 24;
            const rva = view.getUint32(optional + 104, true);
            const size = view.getUint32(optional + 108, true);
            if (!rva || !size) continue;
            for (let descriptor = base + rva; descriptor + 20 <= base + rva + size; descriptor += 20) {
                const nameRva = view.getUint32(descriptor + 12, true);
                if (!nameRva) break;
                let name = '';
                for (let pointer = base + nameRva; pointer < view.byteLength; pointer++) {
                    const value = view.getUint8(pointer); if (!value) break;
                    name += String.fromCharCode(value);
                }
                if (name) importDllNames.add(name);
            }
        }

        // Register Halo 2 delay-load import slots and thunks
        const delayImports: Array<{ slot: number; thunk: number; dll: string; func: string }> = [
            { slot: 0x86d74c, thunk: 0x412d95, dll: "advapi32.dll", func: "RegQueryValueExW" },
            { slot: 0x86d748, thunk: 0x412dba, dll: "advapi32.dll", func: "RegOpenKeyExW" },
            { slot: 0x86d760, thunk: 0x412ddf, dll: "kernel32.dll", func: "CreateFileW" },
            { slot: 0x86d7ac, thunk: 0x412e04, dll: "kernel32.dll", func: "GetModuleFileNameW" },
            { slot: 0x86d7e4, thunk: 0x412e29, dll: "shell32.dll", func: "ShellExecuteW" },
            { slot: 0x86d7a0, thunk: 0x412e4e, dll: "kernel32.dll", func: "GetFileAttributesW" },
            { slot: 0x86d770, thunk: 0x412e73, dll: "kernel32.dll", func: "ExpandEnvironmentStringsW" },
            { slot: 0x86d804, thunk: 0x412e98, dll: "user32.dll", func: "LoadStringW" },
            { slot: 0x86d7b0, thunk: 0x412ebd, dll: "kernel32.dll", func: "GetModuleHandleW" },
            { slot: 0x86d808, thunk: 0x412ee2, dll: "user32.dll", func: "MessageBoxW" },
            { slot: 0x86d764, thunk: 0x412f07, dll: "kernel32.dll", func: "CreateMutexW" },
            { slot: 0x86d7f8, thunk: 0x412f2c, dll: "user32.dll", func: "GetMessageW" },
            { slot: 0x86d7f4, thunk: 0x412f51, dll: "user32.dll", func: "DispatchMessageW" },
            { slot: 0x86d80c, thunk: 0x412f76, dll: "user32.dll", func: "PeekMessageW" },
            { slot: 0x86d7f0, thunk: 0x412f9b, dll: "user32.dll", func: "DefWindowProcW" },
            { slot: 0x86d7cc, thunk: 0x412fc0, dll: "kernel32.dll", func: "MultiByteToWideChar" },
            { slot: 0x86d7d8, thunk: 0x412fe5, dll: "kernel32.dll", func: "WideCharToMultiByte" },
            { slot: 0x86d7e0, thunk: 0x41300a, dll: "kernel32.dll", func: "lstrlenW" },
            { slot: 0x86d7b4, thunk: 0x41302f, dll: "kernel32.dll", func: "GetProcAddress" },
            { slot: 0x86d7e8, thunk: 0x413054, dll: "user32.dll", func: "CharNextW" },
            { slot: 0x86d814, thunk: 0x413079, dll: "user32.dll", func: "SendMessageW" },
            { slot: 0x86d800, thunk: 0x41309e, dll: "user32.dll", func: "IsWindowUnicode" },
        ];
        for (const d of delayImports) {
            this.bridge.registerIatEntry(d.slot, d.dll, d.func);
            this.bridge.registerIatEntry(d.thunk, d.dll, d.func);
            importDllNames.add(d.dll);
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
        for (const [name, global] of Object.entries(exports)) {
            if (!name.startsWith('aot_native_base_')) continue;
            const dllName = name.slice('aot_native_base_'.length);
            const loaded = system.process?.moduleRegistry?.getByName?.(dllName + '.dll');
            const expected = Number((global as WebAssembly.Global).value) >>> 0;
            if (!loaded || loaded.baseAddress !== expected) {
                throw new Error(`AOT native image base mismatch: ${dllName}, expected 0x${expected.toString(16)}, actual ${loaded ? '0x'+loaded.baseAddress.toString(16) : 'not loaded'}`);
            }
        }
        this.bridge.registerExports(exports);
        Logger.log(LogCategory.SYSTEM, `[Recompiler] Module instantiated with ${Object.keys(exports).length} exports.`);

        // Find entry function
        // PE entry is the entire native wrapper, not a cookie-only initializer.
        // Invoke one entry exactly once; an explicit alternate is only for tests/tools.
        const entryAddress = imageBase + view.getUint32(optHeaderOffset + 16, true);
        const targetEntry = entryName === 'entry'
            ? exports[`addr_0x${entryAddress.toString(16)}`] || exports.entry
            : exports[entryName];
        if (typeof targetEntry !== 'function') {
            throw new Error(`[Recompiler] Target entry point "${entryName}" not found in exports!`);
        }


        // Native DLL attach callbacks precede the EXE's CRT, as in the CPU bootloader.
        // Missing compiled entries must stop explicitly rather than skip initialization.
        try {
            for (const dll of options.dllInits ?? []) {
                const esp = stackTop - 16;
                view.setUint32(esp, 0, true);
                view.setUint32(esp + 4, dll.baseAddress, true);
                view.setUint32(esp + 8, 1, true); // DLL_PROCESS_ATTACH
                view.setUint32(esp + 12, 1, true); // static load: lpReserved != NULL
                Logger.log(LogCategory.SYSTEM, `[Recompiler] DllMain ${dll.name}@0x${dll.entryPoint.toString(16)}`);
                const attached = await this.bridge.invokeNative(dll.entryPoint, esp);
                if (!attached) throw new Error(`AOT DllMain rejected process attach: ${dll.name}`);
                const loaded = system.process?.moduleRegistry?.getByBase?.(dll.baseAddress);
                if (loaded) loaded.initialized = true;
            }
            // Invoke entry point exactly once after native DLL initialization.
            Logger.log(LogCategory.SYSTEM, `[Recompiler] Invoking native entry "${entryName}"(esp=0x${stackTop.toString(16)})...`);
            const result = typeof (WebAssembly as any).promising === 'function'
                ? await (WebAssembly as any).promising(targetEntry)(stackTop, 0, 0)
                : targetEntry(stackTop, 0, 0);
            Logger.log(LogCategory.SYSTEM, `[Recompiler] Entry point returned: 0x${(result >>> 0).toString(16)}`);
            return result;
        } catch (e: any) {
            if (exports.aot_unsupported_pc?.value) {
                const address=(exports.aot_unsupported_pc.value >>> 0).toString(16);
                Logger.error(LogCategory.SYSTEM, `[Recompiler] Unsupported guest instruction at 0x${address}`);
                throw new Error(`AOT unsupported guest instruction at 0x${address}`, {cause:e});
            }
            if (exports.aot_debug_pc) Logger.error(LogCategory.SYSTEM, `[Recompiler] Last debug block: 0x${(exports.aot_debug_pc.value >>> 0).toString(16)}`);
                if (exports.aot_debug_fuel?.value === 0) {
                Logger.error(LogCategory.SYSTEM, `[Recompiler] Debug block budget exhausted at 0x${(exports.aot_debug_pc.value >>> 0).toString(16)}`);
            }
            Logger.error(LogCategory.SYSTEM, `[Recompiler] Execution exception: ${e.message}`);
            throw e;
        }
    }
}
