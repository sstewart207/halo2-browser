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

for (const Bridge of [BrowserBridge, ToolBridge]) it(`CALL [IAT]; RET 4 thunk preserves both return frames (${Bridge === BrowserBridge ? 'browser' : 'tool'})`, () => {
    const memory=new WebAssembly.Memory({initial:1});const v=new DataView(memory.buffer);
    v.setUint16(0x1000,0x15ff,true);v.setUint32(0x1002,0x2000,true);v.setUint8(0x1006,0xc2);v.setUint16(0x1007,4,true);
    v.setUint32(0x8000,0x556677,true);v.setUint32(0x8004,0xabc,true);
    const resolver={resolve:(addr:number)=>addr===0x2000?{dll:'kernel32',func:'TlsAlloc'}:null};
    const b=new Bridge({memory,iatResolver:resolver as any});const esp=new WebAssembly.Global({value:'i32',mutable:true},0x8000);b.registerExports({esp});
    let calls=0;b.registerModule('kernel32',{TlsAlloc:()=>{calls++;return {value:2,stackCleanup:0};}});
    const invoke=(b.createWasmImports().env as any).indirect_call;
    expect(invoke(0x1000,0x8000,0,0)).toBe(2);expect(calls).toBe(1);expect(esp.value).toBe(0x8008);
    expect(v.getUint32(0x7ffc,true)).toBe(0x1006);expect(v.getUint32(0x8000,true)).toBe(0x556677);
});

for (const Bridge of [BrowserBridge, ToolBridge]) it(`E9 export trampolines preserve caller args and signed displacement (${Bridge === BrowserBridge ? 'browser' : 'tool'})`, () => {
    const memory=new WebAssembly.Memory({initial:1});const v=new DataView(memory.buffer);const b=new Bridge({memory});
    const api=b.registerDynamicApi('kernel32','TlsGetValue');
    v.setUint8(0x1100,0xe9);v.setInt32(0x1101,0x1000-0x1105,true);v.setUint8(0x1000,0xe9);v.setInt32(0x1001,api-0x1005,true);v.setUint32(0x8004,9,true);
    b.registerModule('kernel32',{TlsGetValue:(_ctx,_mem,args)=>{expect(args[0]).toBe(9);return {value:55,stackCleanup:4};}});
    const esp=new WebAssembly.Global({value:'i32',mutable:true},0x8000);b.registerExports({esp});
    expect((b.createWasmImports().env as any).indirect_call(0x1100,0x8000,0,0)).toBe(55);expect(esp.value).toBe(0x8008);
});
