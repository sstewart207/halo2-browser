/**
 * runtime-bridge.ts — Stage 3 Runtime Linker connecting recompiled WebAssembly modules
 * to BottleShip Win32 and Direct3D HLE implementations with zero emulation trap overhead.
 */

import { X86Context, ThunkImplementation, ThunkDispatcher } from '../../src/worker/core/thunking/thunk-dispatcher';
import { IATResolver, IATEntry } from './iat-resolver';

export interface RuntimeBridgeOptions {
    memory: WebAssembly.Memory;
    iatResolver?: IATResolver;
    dispatcher?: ThunkDispatcher;
    logCalls?: boolean;
}

export class RuntimeBridge {
    memory: WebAssembly.Memory;
    iatResolver: IATResolver;
    dispatcher?: ThunkDispatcher;
    logCalls: boolean;
    private apiModules = new Map<string, Record<string, ThunkImplementation>>();
    private registeredImports: Record<string, Function> = {};
    private addressToExport = new Map<number, (esp: number, ecx: number, eax: number) => number>();
    private dynamicApiMap = new Map<number, { dll: string; func: string }>();
    private nextDynamicApiAddr = 0x71000000;

    constructor(options: RuntimeBridgeOptions) {
        this.memory = options.memory;
        this.iatResolver = options.iatResolver || new IATResolver();
        this.dispatcher = options.dispatcher;
        this.logCalls = !!options.logCalls;
    }

    registerModule(moduleName: string, exports: Record<string, ThunkImplementation>) {
        this.apiModules.set(moduleName.toLowerCase(), exports);
    }

    private dynamicIatTable = new Map<number, { dll: string; func: string }>();

    registerIatEntry(address: number, dll: string, func: string) {
        this.dynamicIatTable.set(address, { dll, func });
        if (!this.iatResolver) {
            this.iatResolver = {
                resolve: (addr: number) => (this.dynamicIatTable.get(addr) as any) || undefined,
            } as any;
        }
    }

    registerExports(exports: Record<string, any>, functions?: Array<{ entry: string; name: string }>) {
        if (functions) {
            for (const fn of functions) {
                const addr = parseInt(fn.entry, 16);
                const wasmFn = exports[fn.name];
                if (typeof wasmFn === 'function') {
                    this.addressToExport.set(addr, wasmFn);
                }
            }
        }
        for (const [name, val] of Object.entries(exports)) {
            if (typeof val === 'function') {
                const m = name.match(/^(?:FUN_|addr_0x|addr_|fn_0x)([0-9a-fA-F]+)/);
                if (m) {
                    const addr = parseInt(m[1], 16);
                    this.addressToExport.set(addr, val as any);
                }
            }
        }
    }

    registerDynamicApi(dll: string, func: string): number {
        const addr = this.nextDynamicApiAddr;
        this.nextDynamicApiAddr += 16;
        this.dynamicApiMap.set(addr, { dll, func });
        return addr;
    }

    callApi(dll: string, func: string, esp: number, argCount: number = 4): number {
        const memBytes = new Uint8Array(this.memory.buffer);
        const view = new DataView(this.memory.buffer);

        // Read arguments from stack: [esp+4], [esp+8], ...
        const args: number[] = [];
        for (let i = 0; i < argCount; i++) {
            args.push(view.getUint32(esp + 4 + i * 4, true));
        }

        const ctx: X86Context = {
            eax: 0,
            ecx: 0,
            edx: 0,
            ebx: 0,
            esp,
            ebp: 0,
            esi: 0,
            edi: 0,
            eip: 0,
            eflags: 0,
        };

        const mod = this.apiModules.get(dll.toLowerCase());
        let impl = mod ? mod[func] : null;

        if (!impl && this.dispatcher) {
            impl = this.dispatcher.getImplementation(dll, func);
        }

        if (this.logCalls) {
            console.log(`[RuntimeBridge] CALL ${dll}!${func}(${args.map(a => '0x' + (a >>> 0).toString(16)).join(', ')})`);
        }

        if (impl) {
            const res = impl(ctx, memBytes, args);
            if (typeof res === 'number') {
                return res;
            }
            if (typeof res === 'object' && res !== null && 'value' in res) {
                return (res as any).value;
            }
            return 0;
        }

        console.warn(`[RuntimeBridge] Unimplemented Win32 API: ${dll}!${func}`);
        return 0;
    }

    bindIndirectCall(): void {
        this.registeredImports['indirect_call'] = (target: number, esp: number, ecx: number, eax: number): number => {
            const addr = target >>> 0;

            // 1. Direct recompiled function export
            const wasmFn = this.addressToExport.get(addr);
            if (wasmFn) {
                return wasmFn(esp, ecx, eax);
            }

            // 2. Direct IAT resolution
            if (this.iatResolver) {
                const entry = this.iatResolver.resolve(addr);
                if (entry) {
                    return this.callApi(entry.dll, entry.func, esp);
                }
            }

            // 3. Inspect linear memory at target for x86 CALL/JMP thunk
            // e.g. CALL [iat_addr] (0xff 0x15 <iat_addr>) or JMP [iat_addr] (0xff 0x25 <iat_addr>)
            if (addr > 0 && addr + 6 <= this.memory.buffer.byteLength) {
                const view = new DataView(this.memory.buffer);
                const opcode = view.getUint16(addr, true);
                if (opcode === 0x15ff || opcode === 0x25ff) {
                    const iatTarget = view.getUint32(addr + 2, true);
                    if (this.iatResolver) {
                        const entry = this.iatResolver.resolve(iatTarget);
                        if (entry) {
                            return this.callApi(entry.dll, entry.func, esp);
                        }
                    }
                }
            }

            // 4. ThunkDispatcher stub
            if (this.dispatcher) {
                const stub = this.dispatcher.getStubByAddress(addr);
                if (stub) {
                    return this.callApi(stub.dllName, stub.functionName, esp);
                }
            }

            // 5. Dynamic API map (from GetProcAddress)
            if (this.dynamicApiMap.has(addr)) {
                const { dll, func } = this.dynamicApiMap.get(addr)!;
                return this.callApi(dll, func, esp);
            }

            if (this.logCalls) {
                console.warn(`[RuntimeBridge] Unresolved indirect call to 0x${addr.toString(16)} (esp=0x${esp.toString(16)}, ecx=0x${ecx.toString(16)}, eax=0x${eax.toString(16)})`);
            }
            return 0;
        };
    }

    createWasmImports(): WebAssembly.Imports {
        this.bindIndirectCall();
        const envImports: Record<string, any> = {
            memory: this.memory,
            ...this.registeredImports,
        };

        return {
            env: envImports,
        };
    }

    /**
     * Binds an imported Win32 API to a WebAssembly callable bridge.
     * The recompiled code passes its stack pointer ($esp) as argument,
     * allowing the bridge to read stdcall/cdecl parameters directly from linear memory.
     */
    bindApi(dll: string, func: string, argCount: number = 4): string {
        const importName = `win32_${dll.toLowerCase()}_${func}`;
        if (this.registeredImports[importName]) {
            return importName;
        }

        this.registeredImports[importName] = (esp: number): number => {
            return this.callApi(dll, func, esp, argCount);
        };

        return importName;
    }
}
