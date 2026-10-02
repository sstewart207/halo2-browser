import { describe, it, expect } from 'bun:test';
import { RecompilerRunner } from '../../src/worker/core/recompiler/recompiler-runner';
import { WasmModuleBuilder } from '../recompiler/wasm-builder';

describe('RecompilerRunner AOT Integration', () => {
    it('initializes TEB/PEB and executes recompiled WebAssembly entry point', async () => {
        // Build a minimal test WASM module that imports memory and verifies TEB at 0x30000
        const builder = new WasmModuleBuilder();
        builder.importMemory = true;
        builder.memoryPages = 160;

        // Sig: (esp, ecx, eax) -> i32
        const sig = builder.addSignature([0x7f, 0x7f, 0x7f], [0x7f]);
        const fn = builder.addFunction('___tmainCRTStartup', sig);

        // Read TEB Self pointer from 0x30018:
        fn.i32_const(0x00030018);
        fn.i32_load(0, 2);
        // Add 42 to verify execution
        fn.i32_const(42);
        fn.i32_add();
        fn.return_op();

        builder.addExport('___tmainCRTStartup', 0, 0);

        const wasmBytes = builder.toBinary();
        const memory = new WebAssembly.Memory({ initial: 160, maximum: 160 });

        const mockSystem = {
            process: {
                moduleRegistry: {
                    getMainExecutableBase: () => 0x00400000,
                },
                dispatcher: null,
            },
        } as any;

        const runner = new RecompilerRunner();
        const result = await runner.start({
            system: mockSystem,
            memory,
            wasmBytes,
            stackTop: 0x19ff00,
            entryName: '___tmainCRTStartup',
        });

        // 0x00030000 (TEB self) + 42 = 0x3002a (196650)
        expect(result).toBe(0x00030000 + 42);

        // Verify that TEB page was properly written in memory
        const view = new DataView(memory.buffer);
        expect(view.getUint32(0x00030000, true)).toBe(0xffffffff); // ExceptionList
        expect(view.getUint32(0x00030018, true)).toBe(0x00030000); // Self
        expect(view.getUint32(0x00030020, true)).toBe(1234);       // PID
        expect(view.getUint32(0x00030024, true)).toBe(42);         // TID
        expect(view.getUint32(0x00030030, true)).toBe(0x00031000); // PEB
    });
});

it('executes the PE wrapper once without independently starting CRT again', async () => {
    const builder=new WasmModuleBuilder();builder.importMemory=true;builder.memoryPages=160;
    const sig=builder.addSignature([0x7f,0x7f,0x7f],[0x7f]);
    const counter=builder.addGlobal(0x7f,1,0);builder.addExport('count',3,counter);
    const entry=builder.addFunction('entry',sig);entry.global_get(counter);entry.i32_const(1);entry.i32_add();entry.global_set(counter);entry.i32_const(7);entry.return_op();
    const crt=builder.addFunction('___tmainCRTStartup',sig);crt.emitBytes([0x00]);crt.i32_const(99);crt.return_op();
    builder.addExport('entry',0,0);builder.addExport('addr_0x401000',0,0);builder.addExport('___tmainCRTStartup',0,1);
    const memory=new WebAssembly.Memory({initial:160});const view=new DataView(memory.buffer);
    view.setUint32(0x400000+24+16,0x1000,true);
    const runner=new RecompilerRunner();
    expect(await runner.start({system:{process:{moduleRegistry:{getMainExecutableBase:()=>0x400000},dispatcher:null}} as any,memory,wasmBytes:builder.toBinary(),stackTop:0x19ff00})).toBe(7);
    const instance=(runner as any).instance as WebAssembly.Instance;
    expect((instance.exports.count as WebAssembly.Global).value).toBe(1);
});
