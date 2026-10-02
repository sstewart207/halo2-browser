import { expect, test } from 'bun:test';
import { Lifter } from '../recompiler/lifter';
import { CFGFunction } from '../recompiler/types';
import { RuntimeBridge } from '../recompiler/runtime-bridge';

test('Lifter: callee RET imm correctly adjusts caller ESP across internal call', async () => {
    // Function B at 0x1000: takes 1 arg, adds 42, returns with RET 4
    const fnB: CFGFunction = {
        name: 'fn_callee',
        entry: '0x1000',
        rva: '0x1000',
        size: 16,
        basicBlocks: [
            {
                start: '0x1000',
                end: '0x100f',
                destinations: [],
                instructions: [
                    { addr: '0x1000', len: 4, mnemonic: 'MOV', ops: 'EAX, dword ptr [ESP + 0x4]' },
                    { addr: '0x1004', len: 3, mnemonic: 'ADD', ops: 'EAX, 0x2a' },
                    { addr: '0x1007', len: 3, mnemonic: 'RET', ops: '0x4' },
                ]
            }
        ]
    };

    // Function A at 0x2000: pushes 10, calls fnB (0x1000), checks ESP restored
    const fnA: CFGFunction = {
        name: 'fn_caller',
        entry: '0x2000',
        rva: '0x2000',
        size: 32,
        basicBlocks: [
            {
                start: '0x2000',
                end: '0x201f',
                destinations: [],
                instructions: [
                    { addr: '0x2000', len: 5, mnemonic: 'PUSH', ops: '0xa' },
                    { addr: '0x2005', len: 5, mnemonic: 'CALL', ops: '0x1000' },
                    // After CALL, since fnB did RET 4, ESP should be back to initial ESP!
                    // Let's copy ESP into EAX so we can inspect it
                    { addr: '0x200a', len: 2, mnemonic: 'MOV', ops: 'EAX, ESP' },
                    { addr: '0x200c', len: 1, mnemonic: 'RET', ops: '' },
                ]
            }
        ]
    };

    const lifter = new Lifter({ importMemory: true, memoryPages: 64 });
    lifter.prepareModule([fnB, fnA]);

    lifter.liftFunction(fnB);
    lifter.liftFunction(fnA);
    lifter.moduleBuilder.addExport('caller', 0, 1);
    lifter.moduleBuilder.addExport('callee', 0, 0);

    const wasmBytes = lifter.moduleBuilder.toBinary();
    const memory = new WebAssembly.Memory({ initial: 64, maximum: 64 });
    const bridge = new RuntimeBridge({ memory });


    const mod = await WebAssembly.compile(wasmBytes as any);
    const instance = await WebAssembly.instantiate(mod, bridge.createWasmImports());
    bridge.registerExports(instance.exports);

    const exports = instance.exports as any;
    const initialEsp = 0x19ff00;
    const finalEsp = exports.caller(initialEsp, 0, 0);

    // Caller ESP should be restored to initialEsp (0x19ff00) because fnB popped the pushed 0xa!
    expect(finalEsp).toBe(initialEsp);
    expect(exports.esp.value).toBe(initialEsp + 4); // caller's own RET popped caller's return address
});

test('RuntimeBridge: stdcall Win32 API correctly pops arguments from caller ESP', async () => {
    // Function that calls kernel32!SetLastError (1 arg = 4 bytes)
    const fnCaller: CFGFunction = {
        name: 'test_set_last_error',
        entry: '0x3000',
        rva: '0x3000',
        size: 32,
        basicBlocks: [
            {
                start: '0x3000',
                end: '0x301f',
                destinations: [],
                instructions: [
                    { addr: '0x3000', len: 5, mnemonic: 'PUSH', ops: '0x7f' },
                    { addr: '0x3005', len: 6, mnemonic: 'CALL', ops: 'dword ptr [0x4000]' },
                    // After CALL, ESP should be restored
                    { addr: '0x300b', len: 2, mnemonic: 'MOV', ops: 'EAX, ESP' },
                    { addr: '0x300d', len: 1, mnemonic: 'RET', ops: '' },
                ]
            }
        ]
    };

    const lifter = new Lifter({ importMemory: true, memoryPages: 64 });
    lifter.prepareModule([fnCaller]);
    lifter.liftFunction(fnCaller);
    lifter.moduleBuilder.addExport('testCaller', 0, 0);

    const wasmBytes = lifter.moduleBuilder.toBinary();
    const memory = new WebAssembly.Memory({ initial: 64, maximum: 64 });
    const bridge = new RuntimeBridge({ memory });

    let calledVal = 0;
    bridge.registerModule('kernel32', {
        SetLastError: (_ctx, _mem, args) => {
            calledVal = args[0];
            return 0;
        }
    });

    const memView = new DataView(memory.buffer);
    memView.setUint32(0x4000, 0x4000, true);
    bridge.registerIatEntry(0x4000, 'kernel32', 'SetLastError');

    const mod = await WebAssembly.compile(wasmBytes as any);
    const instance = await WebAssembly.instantiate(mod, bridge.createWasmImports());
    bridge.registerExports(instance.exports);

    const exports = instance.exports as any;
    const initialEsp = 0x19ff00;
    const finalEsp = exports.testCaller(initialEsp, 0, 0);

    expect(calledVal).toBe(0x7f);
    expect(finalEsp).toBe(initialEsp); // ESP restored after SetLastError popped its 1 argument!
    expect(exports.esp.value).toBe(initialEsp + 4);
});

