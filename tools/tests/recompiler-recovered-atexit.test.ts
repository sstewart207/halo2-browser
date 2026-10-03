import { test, expect } from 'bun:test';
import { Lifter } from '../recompiler/lifter';
import { RuntimeBridge } from '../recompiler/runtime-bridge';
import type { CFGFunction } from '../recompiler/types';

test('AOT_recovered_0069d8d1: skips cleanup when flag byte is 0', () => {
    const fn: CFGFunction = {
        name: 'AOT_recovered_0069d8d1',
        entry: '0x69d8d1',
        rva: '0x29d8d1',
        size: 36,
        basicBlocks: [
            {
                start: '0x69d8d1',
                end: '0x69d8d9',
                instructions: [
                    { addr: '0x69d8d1', len: 7, mnemonic: 'CMP', ops: 'byte ptr [0x00000104], 0x0' },
                    { addr: '0x69d8d8', len: 2, mnemonic: 'JZ', ops: '0x0069d8f4' }
                ],
                destinations: [
                    { addr: '0x69d8f4', type: 'CONDITIONAL_JUMP' },
                    { addr: '0x69d8da', type: 'FALL_THROUGH' }
                ]
            },
            {
                start: '0x69d8da',
                end: '0x69d8f3',
                instructions: [
                    { addr: '0x69d8da', len: 6, mnemonic: 'PUSH', ops: 'dword ptr [0x00000100]' },
                    { addr: '0x69d8e0', len: 5, mnemonic: 'MOV', ops: 'EAX, 0x1234' },
                    { addr: '0x69d8e5', len: 1, mnemonic: 'POP', ops: 'ECX' },
                    { addr: '0x69d8ed', len: 7, mnemonic: 'MOV', ops: 'byte ptr [0x00000104], 0x0' }
                ],
                destinations: [
                    { addr: '0x69d8f4', type: 'FALL_THROUGH' }
                ]
            },
            {
                start: '0x69d8f4',
                end: '0x69d8f4',
                instructions: [
                    { addr: '0x69d8f4', len: 1, mnemonic: 'RET', ops: '' }
                ],
                destinations: []
            }
        ]
    };

    const lifter = new Lifter({ importMemory: true, memoryPages: 1 });
    lifter.prepareModule([fn]);
    lifter.liftFunction(fn);
    lifter.moduleBuilder.addExport('AOT_recovered_0069d8d1', 0, 0);

    const memory = new WebAssembly.Memory({ initial: 1 });
    const view = new DataView(memory.buffer);
    // Flag is 0
    view.setUint8(0x104, 0);
    // Pre-populate EAX with 0x999
    const bridge = new RuntimeBridge({ memory });
    const instance = new WebAssembly.Instance(
        new WebAssembly.Module(lifter.moduleBuilder.toBinary()),
        bridge.createWasmImports()
    );

    const ret = (instance.exports.AOT_recovered_0069d8d1 as Function)(0x8000, 0, 0x999);
    // Jump taken: block 1 skipped, EAX was not set to 0x1234
    expect(ret).toBe(0x999);
    expect(view.getUint8(0x104)).toBe(0);
});

test('AOT_recovered_0069d8d1: executes cleanup when flag byte is 1', () => {
    const fn: CFGFunction = {
        name: 'AOT_recovered_0069d8d1',
        entry: '0x69d8d1',
        rva: '0x29d8d1',
        size: 36,
        basicBlocks: [
            {
                start: '0x69d8d1',
                end: '0x69d8d9',
                instructions: [
                    { addr: '0x69d8d1', len: 7, mnemonic: 'CMP', ops: 'byte ptr [0x00000104], 0x0' },
                    { addr: '0x69d8d8', len: 2, mnemonic: 'JZ', ops: '0x0069d8f4' }
                ],
                destinations: [
                    { addr: '0x69d8f4', type: 'CONDITIONAL_JUMP' },
                    { addr: '0x69d8da', type: 'FALL_THROUGH' }
                ]
            },
            {
                start: '0x69d8da',
                end: '0x69d8f3',
                instructions: [
                    { addr: '0x69d8da', len: 6, mnemonic: 'PUSH', ops: 'dword ptr [0x00000100]' },
                    { addr: '0x69d8e0', len: 5, mnemonic: 'MOV', ops: 'EAX, 0x1234' },
                    { addr: '0x69d8e5', len: 1, mnemonic: 'POP', ops: 'ECX' },
                    { addr: '0x69d8ed', len: 7, mnemonic: 'MOV', ops: 'byte ptr [0x00000104], 0x0' }
                ],
                destinations: [
                    { addr: '0x69d8f4', type: 'FALL_THROUGH' }
                ]
            },
            {
                start: '0x69d8f4',
                end: '0x69d8f4',
                instructions: [
                    { addr: '0x69d8f4', len: 1, mnemonic: 'RET', ops: '' }
                ],
                destinations: []
            }
        ]
    };

    const lifter = new Lifter({ importMemory: true, memoryPages: 1 });
    lifter.prepareModule([fn]);
    lifter.liftFunction(fn);
    lifter.moduleBuilder.addExport('AOT_recovered_0069d8d1', 0, 0);

    const memory = new WebAssembly.Memory({ initial: 1 });
    const view = new DataView(memory.buffer);
    // Flag is 1
    view.setUint8(0x104, 1);
    view.setUint32(0x100, 0xcafe, true);

    const bridge = new RuntimeBridge({ memory });
    const instance = new WebAssembly.Instance(
        new WebAssembly.Module(lifter.moduleBuilder.toBinary()),
        bridge.createWasmImports()
    );

    const ret = (instance.exports.AOT_recovered_0069d8d1 as Function)(0x8000, 0, 0x999);
    // Cleanup executed: EAX set to 0x1234, flag cleared to 0
    expect(ret).toBe(0x1234);
    expect(view.getUint8(0x104)).toBe(0);
});
