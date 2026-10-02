import { describe, it, expect } from 'bun:test';
import { RuntimeBridge as BrowserBridge } from '../../src/worker/core/recompiler/runtime-bridge';
import { RuntimeBridge as ToolBridge } from '../recompiler/runtime-bridge';

for (const Bridge of [BrowserBridge, ToolBridge]) describe(`AOT async ${Bridge === BrowserBridge ? 'browser' : 'tool'} bridge`, () => {
    it('preserves the guest stack while pending and applies returned ABI cleanup after resolution', async () => {
        const memory = new WebAssembly.Memory({initial: 1});
        const bridge = new Bridge({memory, enableAsync: true});
        const esp = new WebAssembly.Global({value: 'i32', mutable: true}, 0x100);
        bridge.registerExports({esp});
        new DataView(memory.buffer).setUint32(0x104, 0x4455, true);
        let resolve!: (result: {value: number; stackCleanup: number}) => void;
        bridge.registerModule('kernel32', {LoadLibraryA: (_ctx, _mem, args) => {
            expect(args[0]).toBe(0x4455);
            return new Promise(done => {resolve = done;});
        }});
        const result = bridge.callApi('kernel32', 'LoadLibraryA', 0x100, 1);
        expect(result).toBeInstanceOf(Promise);
        expect(esp.value).toBe(0x100);
        resolve({value: 0x9000, stackCleanup: 4});
        expect(await result).toBe(0x9000);
        expect(esp.value).toBe(0x108);
    });
    it('does not report success when asynchronous loading requires unhandled native initialization', async () => {
        const bridge = new Bridge({memory: new WebAssembly.Memory({initial: 1}), enableAsync: true});
        bridge.registerModule('kernel32', {LoadLibraryA: async () => ({value: 0x8000, stackCleanup: 4,
            dllInits: [{name: 'test.dll', baseAddress: 0x8000, entryPoint: 0x8100}]})});
        await expect(bridge.callApi('kernel32', 'LoadLibraryA', 0x100, 1)).rejects.toThrow('test.dll@0x8100');
    });
});
