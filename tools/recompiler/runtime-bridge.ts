/**
 * runtime-bridge.ts — Stage 3 Runtime Linker connecting recompiled WebAssembly modules
 * to BottleShip Win32 and Direct3D HLE implementations with zero emulation trap overhead.
 */

import { X86Context, ThunkImplementation, ThunkDispatcher } from '../../src/worker/core/thunking/thunk-dispatcher';
import { IATResolver, IATEntry } from './iat-resolver';

export interface RuntimeBridgeOptions {
    memory: WebAssembly.Memory;
    memoryOffset?: number;
    memoryLength?: number;
    iatResolver?: IATResolver;
    dispatcher?: ThunkDispatcher;
    logCalls?: boolean;
}

const KNOWN_WIN32_ARG_COUNTS = new Map<string, number>([
    ['kernel32:getprocaddress', 2],
    ['kernel32:getmodulehandlea', 1],
    ['kernel32:getmodulehandlew', 1],
    ['kernel32:loadlibrarya', 1],
    ['kernel32:loadlibraryw', 1],
    ['kernel32:freelibrary', 1],
    ['kernel32:getlasterror', 0],
    ['kernel32:setlasterror', 1],
    ['kernel32:tlsalloc', 0],
    ['kernel32:tlsfree', 1],
    ['kernel32:tlsgetvalue', 1],
    ['kernel32:tlssetvalue', 2],
    ['kernel32:flsalloc', 1],
    ['kernel32:flsfree', 1],
    ['kernel32:flsgetvalue', 1],
    ['kernel32:flssetvalue', 2],
    ['kernel32:heapalloc', 3],
    ['kernel32:heapfree', 3],
    ['kernel32:heaprealloc', 4],
    ['kernel32:heapsize', 3],
    ['kernel32:heapcreate', 3],
    ['kernel32:heapdestroy', 1],
    ['kernel32:getprocessheap', 0],
    ['kernel32:decodepointer', 1],
    ['kernel32:encodepointer', 1],
    ['kernel32:deletecriticalsection', 1],
    ['kernel32:initializecriticalsection', 1],
    ['kernel32:initializecriticalsectionandspincount', 2],
    ['kernel32:entercriticalsection', 1],
    ['kernel32:leavecriticalsection', 1],
    ['kernel32:getsystemtimeasfiletime', 1],
    ['kernel32:queryperformancecounter', 1],
    ['kernel32:queryperformancefrequency', 1],
    ['kernel32:getcurrentprocessid', 0],
    ['kernel32:getcurrentthreadid', 0],
    ['kernel32:getcurrentprocess', 0],
    ['kernel32:getcurrentthread', 0],
    ['kernel32:gettickcount', 0],
    ['kernel32:getstartupinfoa', 1],
    ['kernel32:getstartupinfow', 1],
    ['kernel32:getversion', 0],
    ['kernel32:getversionexa', 1],
    ['kernel32:getversionexw', 1],
    ['kernel32:getcommandlinea', 0],
    ['kernel32:getcommandlinew', 0],
    ['kernel32:exitprocess', 1],
    ['kernel32:sleep', 1],
    ['kernel32:sleepex', 2],
    ['kernel32:waitforsingleobject', 2],
    ['kernel32:waitforsingleobjectex', 3],
    ['kernel32:createeventa', 4],
    ['kernel32:createeventw', 4],
    ['kernel32:setevent', 1],
    ['kernel32:resetevent', 1],
    ['kernel32:closehandle', 1],
    ['kernel32:createfilea', 7],
    ['kernel32:createfilew', 7],
    ['kernel32:readfile', 5],
    ['kernel32:writefile', 5],
    ['kernel32:setfilepointer', 4],
    ['kernel32:setendoffile', 1],
    ['kernel32:getfilesize', 2],
    ['kernel32:getfilesizeex', 2],
    ['kernel32:virtualalloc', 4],
    ['kernel32:virtualfree', 3],
    ['kernel32:virtualprotect', 4],
    ['kernel32:virtualquery', 3],
    ['kernel32:interlockedexchange', 2],
    ['kernel32:interlockedcompareexchange', 3],
    ['kernel32:interlockedincrement', 1],
    ['kernel32:interlockeddecrement', 1],
    ['kernel32:interlockedexchangeadd', 2],
    ['kernel32:multibytetowidechar', 6],
    ['kernel32:widechartomultibyte', 8],
    ['kernel32:isprocessorfeaturepresent', 1],
    ['kernel32:isdebuggerpresent', 0],
    ['kernel32:unhandledexceptionfilter', 1],
    ['kernel32:setunhandledexceptionfilter', 1],
    ['kernel32:raiseexception', 4],
    ['kernel32:rtlunwind', 4],
    ['kernel32:getmodulefilenamea', 3],
    ['kernel32:getmodulefilenamew', 3],
    ['d3d9:direct3dcreate9', 1],
]);

export class RuntimeBridge {

    memory: WebAssembly.Memory;
    iatResolver: IATResolver;
    dispatcher?: ThunkDispatcher;
    logCalls: boolean;
    espGlobal?: WebAssembly.Global;
    private apiModules = new Map<string, Record<string, ThunkImplementation>>();
    private registeredImports: Record<string, Function> = {};
    private addressToExport = new Map<number, (esp: number, ecx: number, eax: number) => number>();
    private dynamicApiMap = new Map<number, { dll: string; func: string }>();
    private nextDynamicApiAddr = 0x71000000;

    constructor(options: RuntimeBridgeOptions) {
        this.memory = options.memory;
        this.memoryOffset = options.memoryOffset ?? 0;
        this.memoryLength = options.memoryLength;
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
        if (exports.esp && typeof exports.esp === 'object' && 'value' in exports.esp) {
            this.espGlobal = exports.esp as WebAssembly.Global;
        }
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

    getStackCleanupBytes(dll: string, func: string, defaultArgCount: number = 4): number {

        const m = func.match(/@(\d+)$/);
        if (m) {
            return parseInt(m[1], 10);
        }
        if (this.dispatcher) {
            const stub = this.dispatcher.getStubByName?.(dll, func);
            if (stub && stub.stackCleanupBytes !== undefined) {
                return stub.stackCleanupBytes;
            }
        }
        const key = `${dll.toLowerCase().replace(/\.dll$/, '')}:${func.toLowerCase()}`;
        if (KNOWN_WIN32_ARG_COUNTS.has(key)) {
            return KNOWN_WIN32_ARG_COUNTS.get(key)! * 4;
        }
        return defaultArgCount * 4;
    }

    callApi(dll: string, func: string, esp: number, argCount: number = 4): number {
        const memBytes = new Uint8Array(this.memory.buffer, this.memoryOffset, this.memoryLength);
        const view = new DataView(this.memory.buffer, this.memoryOffset, this.memoryLength);

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

        let returnVal = 0;
        if (impl) {
            const res = impl(ctx, memBytes, args);
            if (res instanceof Promise) throw new Error(`AOT async API unsupported: ${dll}!${func}`);
            if (typeof res === 'object' && res !== null && 'terminated' in res && res.terminated) {
                throw new Error(`AOT process terminated by ${dll}!${func} (argument 0x${(args[0] >>> 0).toString(16)})`);
            }
            if (typeof res === 'number') {
                returnVal = res;
            } else if (typeof res === 'object' && res !== null && 'value' in res) {
                returnVal = (res as any).value;
            }
        } else {
            console.warn(`[RuntimeBridge] Unimplemented Win32 API: ${dll}!${func}`);
        }

        // Callee cleans up stack: pop return address (+4) and callee arguments (+cleanupBytes)
        const cleanupBytes = this.getStackCleanupBytes(dll, func, argCount);
        if (this.espGlobal) {
            this.espGlobal.value += 4 + cleanupBytes;
        }

        return returnVal;
    }

    bindIndirectCall(): void {
        this.registeredImports['indirect_call'] = (target: number, esp: number, ecx: number, eax: number): number => {
            const addr = target >>> 0;
            if (this.logCalls) {
                console.log(`[RuntimeBridge] -> indirect_call(target=0x${addr.toString(16)}, esp=0x${esp.toString(16)}, eax=0x${eax.toString(16)})`);
            }

            // 1. Direct recompiled function export
            const wasmFn = this.addressToExport.get(addr);
            if (wasmFn) {
                return wasmFn(0, ecx, eax);
            }


            // 2. Direct IAT resolution (from dynamic table or IATResolver)
            if (this.dynamicIatTable.has(addr)) {
                const entry = this.dynamicIatTable.get(addr)!;
                return this.callApi(entry.dll, entry.func, esp);
            }
            if (this.iatResolver) {
                const entry = this.iatResolver.resolve(addr);
                if (entry) {
                    return this.callApi(entry.dll, entry.func, esp);
                }
            }


            // 3. Inspect linear memory at target for x86 CALL/JMP thunk
            // e.g. CALL [iat_addr] (0xff 0x15 <iat_addr>) or JMP [iat_addr] (0xff 0x25 <iat_addr>)
            if (addr > 0 && addr + 6 <= this.memory.buffer.byteLength) {
                const view = new DataView(this.memory.buffer, this.memoryOffset, this.memoryLength);
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
            if (this.espGlobal) {
                this.espGlobal.value += 4;
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
