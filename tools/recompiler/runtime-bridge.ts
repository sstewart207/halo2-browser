import { aotAtan2, aotCos, loadExtended80 } from '../../src/worker/core/recompiler/x87-math';
/**
 * runtime-bridge.ts — Stage 3 Runtime Linker connecting recompiled WebAssembly modules
 * to BottleShip Win32 and Direct3D HLE implementations with zero emulation trap overhead.
 */

import { X86Context, ThunkImplementation, ThunkDispatcher, ThunkResult } from '../../src/worker/core/thunking/thunk-dispatcher';
import { IATResolver, IATEntry } from './iat-resolver';

export interface RuntimeBridgeOptions {
    memory: WebAssembly.Memory;
    enableAsync?: boolean;
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
    ['kernel32:createthread', 6],
    ['kernel32:setthreadpriority', 2],
    ['kernel32:createsemaphorea', 4],
    ['kernel32:createsemaphorew', 4],
    ['kernel32:releasesemaphore', 3],
    ['kernel32:terminatethread', 2],
    ['kernel32:switchtothread', 0],
    ['d3d9:direct3dcreate9', 1],
    ['ole32:cocreateinstance', 5],
    ['ole32:coinitialize', 1],
    ['ole32:coinitializesecurity', 9],
    ['ole32:coinitializeex', 2],
    ['ole32:couninitialize', 0],
    ['ole32:cotaskmemalloc', 1],
    ['ole32:cotaskmemfree', 1],
    ['ole32:coregisterclassobject', 5],
    ['ole32:corevokeclassobject', 1],
    ['ole32:propvariantclear', 1],
    ['ole32:cosetproxyblanket', 8],
    ['user32:getsystemmetrics', 1],
    ['user32:loadcursora', 2],
    ['user32:setcursor', 1],
    ['user32:getcursor', 0],
    ['user32:showwindow', 2],
    ['user32:movewindow', 6],
    ['user32:destroywindow', 1],
    ['user32:getclientrect', 2],
    ['user32:getwindowrect', 2],
    ['user32:screentoclient', 2],
    ['user32:getdc', 1],
    ['user32:releasedc', 2],
    ['user32:beginpaint', 2],
    ['user32:endpaint', 2],
    ['user32:getkeystate', 1],
    ['user32:getasynckeystate', 1],
    ['user32:getkeyboardstate', 1],
    ['user32:setkeyboardstate', 1],
    ['user32:setfocus', 1],
    ['user32:getfocus', 0],
    ['user32:setforegroundwindow', 1],
    ['user32:getforegroundwindow', 0],
    ['user32:postmessagea', 4],
    ['user32:sendmessagea', 4],
    ['user32:postquitmessage', 1],
    ['user32:translatemessage', 1],
    ['user32:adjustwindowrectex', 4],
    ['user32:setwindowpos', 7],
    ['user32:enumdisplaysettingsa', 3],
    ['user32:changedisplaysettingsa', 2],
    ['user32:messageboxa', 4],
    ['user32:unregisterclassa', 2],
    ['user32:isiconic', 1],
    ['user32:getdesktopwindow', 0],
    ['user32:loadicona', 2],
    ['user32:releasecapture', 0],
    ['user32:setcapture', 1],
    ['user32:getcaretblinktime', 0],
    ['user32:getcursorpos', 1],
    ['user32:mapvirtualkeya', 2],
    ['user32:sendinput', 3],
    ['user32:getkeyboardlayout', 1],
    ['user32:getmonitorinfoa', 2],
    ['advapi32:regclosekey', 1],
    ['advapi32:reggetvaluea', 7],
    ['advapi32:regsetvalueexa', 6],
    ['advapi32:regcreatekeyexa', 9],
    ['advapi32:regopenkeyexa', 5],
    ['advapi32:regdeletevaluea', 2],
    ['advapi32:regqueryvalueexa', 6],
    ['advapi32:cryptacquirecontexta', 5],
    ['advapi32:cryptreleasecontext', 2],
    ['advapi32:cryptdestroyhash', 1],
    ['advapi32:cryptgethashparam', 5],
    ['advapi32:cryptcreatehash', 5],
    ['advapi32:cryptdestroykey', 1],
    ['shell32:commandlinetoargvw', 2],
    ['shell32:shgetfolderpathw', 5],
    ['dinput8:directinput8create', 5],
    ['winmm:timegettime', 0],
    ['winmm:timebeginperiod', 1],
    ['winmm:timeendperiod', 1],
    ['version:getfileversioninfosizea', 2],
    ['version:getfileversioninfoa', 4],
    ['version:verqueryvaluea', 4],
]);

export class RuntimeBridge {

    memory: WebAssembly.Memory;
    enableAsync: boolean;
    memoryOffset: number;
    memoryLength?: number;
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
        this.enableAsync = options.enableAsync ?? false;
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

    callApi(dll: string, func: string, esp: number, argCount: number = 4): number | Promise<number> {
        const memBytes = new Uint8Array(this.memory.buffer, this.memoryOffset, this.memoryLength);
        const view = new DataView(this.memory.buffer, this.memoryOffset, this.memoryLength);
        const key = `${dll.toLowerCase().replace(/\.dll$/, '')}:${func.toLowerCase()}`;
        const effectiveArgCount = KNOWN_WIN32_ARG_COUNTS.has(key)
            ? KNOWN_WIN32_ARG_COUNTS.get(key)!
            : argCount;

        // Read arguments from stack: [esp+4], [esp+8], ...
        const args: number[] = [];
        for (let i = 0; i < effectiveArgCount; i++) {
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

        const mod = this.apiModules.get(key.split(':')[0])
            ?? this.apiModules.get(dll.toLowerCase());
        let impl = mod ? mod[func] : null;

        if (!impl && this.dispatcher) {
            impl = this.dispatcher.getImplementation(dll, func);
        }

        if (!impl) {
            const normDll = dll.toLowerCase().replace(/\.dll$/, '');
            if (normDll === 'kernel32') {
                if (func === 'CreateMutexW' || func === 'CreateMutexA') {
                    impl = (_ctx, _mem, _args) => {
                        const lastErrorOffset = 0x00030034;
                        if (lastErrorOffset + 4 <= (this.memoryLength ?? (this.memory.buffer.byteLength - this.memoryOffset))) {
                            new DataView(this.memory.buffer, this.memoryOffset, this.memoryLength).setUint32(lastErrorOffset, 0, true);
                        }
                        return 0x00000400;
                    };
                }
            } else if (normDll === 'pccompat') {
                impl = (_ctx, _mem, _args) => {
                    return 1;
                };
            }
        }

        if (this.logCalls) {
            console.log(`[RuntimeBridge] CALL ${dll}!${func}(${args.map(a => '0x' + (a >>> 0).toString(16)).join(', ')})`);
        }

        if (!impl) throw new Error(`AOT API implementation missing: ${dll}!${func}`);
        const finish = (res: number | ThunkResult): number => {
            if (typeof res === 'object' && res !== null) {
                if (res.terminated) throw new Error(`AOT process terminated by ${dll}!${func} (argument 0x${(args[0] >>> 0).toString(16)})`);
                if (res.dllInits?.length) throw new Error(`AOT native DLL initialization required: ${res.dllInits.map(d => `${d.name}@0x${d.entryPoint.toString(16)}`).join(', ')}`);
                if (res.suspendedForCallback || res.startCallbackChain || res.blockedNoSwitch || res.sehTrampoline || res.deferredWrites?.length) {
                    throw new Error(`AOT API requires unsupported guest continuation: ${dll}!${func}`);
                }
            }
            const cleanup = typeof res === 'object' && res !== null && res.stackCleanup !== undefined
                ? res.stackCleanup : this.getStackCleanupBytes(dll, func, argCount);
            if (this.espGlobal) this.espGlobal.value = (esp + 4 + cleanup) >>> 0;
            return typeof res === 'number' ? res : res.value;
        };
        const res = impl(ctx, memBytes, args);
        if (res instanceof Promise) {
            if (!this.enableAsync) throw new Error(`AOT async API unsupported: ${dll}!${func}`);
            return res.then(finish);
        }
        return finish(res);
    }

    bindIndirectCall(): void {
        this.registeredImports['indirect_call'] = (target: number, esp: number, ecx: number, eax: number): number | Promise<number> => {
            let addr = target >>> 0;
            const guest = new DataView(this.memory.buffer, this.memoryOffset, this.memoryLength);
            // Synthetic HLE export images contain E9 rel32 trampolines to
            // registered API stubs. Follow their real target without CPU execution.
            for (let hops = 0; hops < 16; hops++) {
                if (this.addressToExport.has(addr) || this.dynamicApiMap.has(addr)
                    || this.dynamicIatTable.has(addr) || this.dispatcher?.getStubByAddress(addr)) break;
                if (addr + 5 > guest.byteLength || guest.getUint8(addr) !== 0xe9) break;
                addr = (addr + 5 + guest.getInt32(addr + 1, true)) >>> 0;
                if (hops === 15) throw new Error('AOT jump trampoline chain exceeds 16 hops');
            }
            if (this.logCalls) {
                console.log(`[RuntimeBridge] -> indirect_call(target=0x${addr.toString(16)}, esp=0x${esp.toString(16)}, eax=0x${eax.toString(16)})`);
            }

            // 1. Direct recompiled function export
            const wasmFn = this.addressToExport.get(addr);
            if (wasmFn) {
                // A nested promising boundary lets JSPI suspend across the JS dispatcher.
                if (this.enableAsync) return (WebAssembly as any).promising(wasmFn)(0, ecx, eax);
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
            if (addr > 0 && addr + 9 <= (this.memoryLength ?? (this.memory.buffer.byteLength - this.memoryOffset))) {
                const view = new DataView(this.memory.buffer, this.memoryOffset, this.memoryLength);
                const opcode = view.getUint16(addr, true);
                if (opcode === 0x15ff || opcode === 0x25ff) {
                    const iatTarget = view.getUint32(addr + 2, true);
                    if (this.iatResolver) {
                        const entry = this.iatResolver.resolve(iatTarget);
                        if (entry) {
                            if (opcode === 0x25ff) return this.callApi(entry.dll, entry.func, esp);
                            // CALL [IAT]; RET [imm] is not a tail JMP. Preserve
                            // its inner return frame and execute its outer cleanup.
                            const retOpcode = view.getUint8(addr + 6);
                            if (retOpcode === 0xc3 || retOpcode === 0xc2) {
                                const retBytes = retOpcode === 0xc2 ? view.getUint16(addr + 7, true) : 0;
                                const innerEsp = (esp - 4) >>> 0;
                                view.setUint32(innerEsp, addr + 6, true);
                                if (!this.espGlobal) throw new Error('AOT CALL/RET thunk requires shared ESP');
                                this.espGlobal.value = innerEsp;
                                const result = this.callApi(entry.dll, entry.func, innerEsp);
                                const finish = (value: number) => {
                                    this.espGlobal!.value = (Number(this.espGlobal!.value) + 4 + retBytes) >>> 0;
                                    return value;
                                };
                                return result instanceof Promise ? result.then(finish) : finish(result);
                            }
                        }
                    }
                }
            }

            // 3b. Inspect for MSVC delay-load resolver thunk
            if (addr > 0 && addr + 36 <= (this.memoryLength ?? (this.memory.buffer.byteLength - this.memoryOffset))) {
                const view = new DataView(this.memory.buffer, this.memoryOffset, this.memoryLength);
                if (view.getUint8(addr) === 0x68 &&
                    view.getUint16(addr + 5, true) === 0x35ff &&
                    view.getUint8(addr + 11) === 0x68 &&
                    view.getUint8(addr + 16) === 0x68 &&
                    view.getUint8(addr + 21) === 0x68 &&
                    view.getUint8(addr + 26) === 0xe8 &&
                    view.getUint16(addr + 31, true) === 0x25ff) {
                    const iatSlot = view.getUint32(addr + 12, true);
                    const apiNamePtr = view.getUint32(addr + 17, true);
                    const dllNamePtr = view.getUint32(addr + 22, true);

                    const readAnsi = (ptr: number): string => {
                        let s = '';
                        for (let p = ptr; p < (this.memoryLength ?? (this.memory.buffer.byteLength - this.memoryOffset)); p++) {
                            const b = view.getUint8(p);
                            if (b === 0) break;
                            s += String.fromCharCode(b);
                        }
                        return s;
                    };

                    const apiName = readAnsi(apiNamePtr);
                    const dllName = readAnsi(dllNamePtr);
                    if (apiName && dllName) {
                        this.dynamicIatTable.set(iatSlot, { dll: dllName, func: apiName });
                        this.dynamicIatTable.set(addr, { dll: dllName, func: apiName });
                        return this.callApi(dllName, apiName, esp);
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
            throw new Error(`AOT unresolved indirect call: 0x${addr.toString(16)}`);
        };
    }

    createWasmImports(): WebAssembly.Imports {
        this.bindIndirectCall();
        const envImports: Record<string, any> = {
            memory: this.memory,
            ...this.registeredImports,
            aot_cos: aotCos,
            aot_atan2: aotAtan2,
            aot_load_f80: (address: number) => loadExtended80(this.memory, this.memoryOffset, this.memoryLength, address),
        };

        if (this.enableAsync) {
            const Suspending = (WebAssembly as any).Suspending;
            if (typeof Suspending !== 'function') throw new Error('AOT async execution requires WebAssembly JSPI');
            for (const key of Object.keys(this.registeredImports)) envImports[key] = new Suspending(this.registeredImports[key]);
        }
        return { env: envImports };
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

        this.registeredImports[importName] = (esp: number): number | Promise<number> => {
            return this.callApi(dll, func, esp, argCount);
        };

        return importName;
    }
}
