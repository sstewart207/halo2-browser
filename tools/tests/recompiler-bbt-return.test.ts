import { test, expect } from 'bun:test';
import { Lifter } from '../recompiler/lifter';
import { RuntimeBridge } from '../recompiler/runtime-bridge';
import type { CFGFunction } from '../recompiler/types';

function oneBlock(name: string, entry: number, code: Array<[string, string]>): CFGFunction {
    return {
        name, entry: `0x${entry.toString(16)}`, rva: `0x${entry.toString(16)}`, size: code.length,
        basicBlocks: [{
            start: `0x${entry.toString(16)}`, end: `0x${(entry + code.length - 1).toString(16)}`,
            instructions: code.map(([mnemonic, ops], i) => ({
                addr: `0x${(entry + i).toString(16)}`, len: 1, mnemonic, ops,
            })),
            destinations: [],
        }],
    };
}

test('BBT RET 4 runs its guest hook and continuation before returning to the caller', () => {
    const caller = oneBlock('caller', 0x1000, [
        ['PUSH', '0x1234'], ['CALL', '0x004089ba'], ['ADD', 'ESP, 0x4'],
        ['MOV', 'EAX, ESP'], ['RET', ''],
    ]);
    const wrapper = oneBlock('bbt_wrapper', 0x4089ba, [
        ['LEA', 'ESP, [ESP + -0x4]'], ['MOV', 'dword ptr [ESP], EDI'],
        ['LEA', 'ESP, [ESP + -0x4]'], ['MOV', 'dword ptr [ESP], EDI'],
        ['LEA', 'EDI, [0x4081b5]'], ['LEA', 'EDI, [EDI + 0x83d]'],
        ['MOV', 'dword ptr [ESP + 0x4], EDI'],
        ['LEA', 'EDI, [0x78fb4d]'], ['LEA', 'EDI, [EDI + 0x12a]'],
        ['LEA', 'ESP, [ESP + -0x4]'], ['MOV', 'dword ptr [ESP], EDI'],
        ['MOV', 'EDI, dword ptr [ESP + 0x4]'], ['RET', '0x4'],
    ]);
    const hook = oneBlock('hook', 0x78fc77, [
        ['MOV', 'dword ptr [0x2000], 0x1'], ['RET', ''],
    ]);
    const body = oneBlock('body', 0x4089f2, [
        ['MOV', 'dword ptr [0x2004], 0x1'], ['RET', ''],
    ]);
    const functions = [caller, wrapper, hook, body];
    const lifter = new Lifter({ importMemory: true, memoryPages: 1 });
    lifter.prepareModule(functions);
    for (const fn of functions) lifter.liftFunction(fn);
    lifter.moduleBuilder.addExport('caller', 0, 0);
    lifter.moduleBuilder.addExport('hook', 0, 2);
    lifter.moduleBuilder.addExport('body', 0, 3);
    const memory = new WebAssembly.Memory({ initial: 1 });
    const bridge = new RuntimeBridge({ memory });
    const instance = new WebAssembly.Instance(new WebAssembly.Module(lifter.moduleBuilder.toBinary()), bridge.createWasmImports());
    bridge.registerExports(instance.exports, functions);
    const view = new DataView(memory.buffer);
    const result = (instance.exports.caller as Function)(0x8000, 0, 0);
    expect(view.getUint32(0x2000, true)).toBe(1);
    expect(view.getUint32(0x2004, true)).toBe(1);
    expect(result).toBe(0x8000);
    expect((instance.exports.esp as WebAssembly.Global).value).toBe(0x8004);
});

test('unsigned MUL provides EDX for Halo 2 function-table modulo 124', () => {
    const fn = oneBlock('table_index', 0x42331b, [
        ['MOV', 'ESI, 0x7d'], ['MOV', 'EAX, 0x8421085'], ['MUL', 'ESI'],
        ['MOV', 'EAX, ESI'], ['SUB', 'EAX, EDX'], ['SHR', 'EAX, 0x1'],
        ['ADD', 'EAX, EDX'], ['SHR', 'EAX, 0x6'],
        ['IMUL', 'EAX, EAX, 0x7c'], ['SUB', 'ESI, EAX'],
        ['MOV', 'EAX, dword ptr [ESI*0x4 + 0x2000]'], ['RET', ''],
    ]);
    const lifter = new Lifter({ importMemory: true, memoryPages: 1 });
    lifter.prepareModule([fn]);
    lifter.liftFunction(fn);
    lifter.moduleBuilder.addExport('table_index', 0, 0);
    const memory = new WebAssembly.Memory({ initial: 1 });
    new DataView(memory.buffer).setUint32(0x2000 + 1 * 4, 0x12345678, true);
    const bridge = new RuntimeBridge({ memory });
    const instance = new WebAssembly.Instance(new WebAssembly.Module(lifter.moduleBuilder.toBinary()), bridge.createWasmImports());
    expect((instance.exports.table_index as Function)(0x8000, 0, 0)).toBe(0x12345678);
});

test('PUSHFD in a called profiling hook observes the caller TEST flags', () => {
    const caller = oneBlock('flag_caller', 0x1000, [
        ['MOV', 'ESI, 0x0'], ['TEST', 'ESI, ESI'], ['CALL', '0x2000'], ['RET', ''],
    ]);
    const hook = oneBlock('flag_hook', 0x2000, [
        ['PUSHFD', ''], ['POP', 'EAX'], ['RET', ''],
    ]);
    const lifter = new Lifter({ importMemory: true, memoryPages: 1 });
    lifter.prepareModule([caller, hook]);
    lifter.liftFunction(caller);
    lifter.liftFunction(hook);
    lifter.moduleBuilder.addExport('flag_caller', 0, 0);
    const memory = new WebAssembly.Memory({ initial: 1 });
    const bridge = new RuntimeBridge({ memory });
    const instance = new WebAssembly.Instance(new WebAssembly.Module(lifter.moduleBuilder.toBinary()), bridge.createWasmImports());
    const flags = (instance.exports.flag_caller as Function)(0x8000, 0, 0) >>> 0;
    expect(flags & (0x01 | 0x04 | 0x40 | 0x80 | 0x800)).toBe(0x04 | 0x40);
});
