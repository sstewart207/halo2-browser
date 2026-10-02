/**
 * runtime-bridge.ts — Stage 3 Runtime Linker connecting recompiled WebAssembly modules
 * to BottleShip Win32 and Direct3D HLE implementations with zero emulation trap overhead.
 */

import { X86Context, ThunkImplementation } from '../../src/worker/core/thunking/thunk-dispatcher';
import { IATResolver, IATEntry } from './iat-resolver';

export interface RuntimeBridgeOptions {
    memory: WebAssembly.Memory;
    iatResolver?: IATResolver;
    logCalls?: boolean;
}

export class RuntimeBridge {
    memory: WebAssembly.Memory;
    iatResolver: IATResolver;
    logCalls: boolean;
    private apiModules = new Map<string, Record<string, ThunkImplementation>>();
    private registeredImports: Record<string, Function> = {};

    constructor(options: RuntimeBridgeOptions) {
        this.memory = options.memory;
        this.iatResolver = options.iatResolver || new IATResolver();
        this.logCalls = !!options.logCalls;
    }

    registerModule(moduleName: string, exports: Record<string, ThunkImplementation>) {
        this.apiModules.set(moduleName.toLowerCase(), exports);
    }

    createWasmImports(): WebAssembly.Imports {
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

        const bridgeFn = (esp: number): number => {
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
            const impl = mod ? mod[func] : null;

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
        };

        this.registeredImports[importName] = bridgeFn;
        return importName;
    }
}
