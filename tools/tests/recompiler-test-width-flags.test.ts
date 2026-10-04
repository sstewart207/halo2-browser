import { test, expect } from 'bun:test';
import { Lifter } from '../recompiler/lifter';
import { RuntimeBridge } from '../recompiler/runtime-bridge';
import type { CFGFunction } from '../recompiler/types';

function testSignBranch(register: 'BL' | 'BX' | 'EBX', value: number): number {
    const instruction = (addr: string, mnemonic: string, ops: string) => ({ addr, len: 1, mnemonic, ops });
    const fn: CFGFunction = {
        name: 'test_sign_branch', entry: '0x1000', rva: '0x1000', size: 8,
        basicBlocks: [
            {
                start: '0x1000', end: '0x1002',
                instructions: [
                    instruction('0x1000', 'MOV', `EBX, 0x${value.toString(16)}`),
                    instruction('0x1001', 'TEST', `${register}, ${register}`),
                    instruction('0x1002', 'JGE', '0x1006'),
                ],
                destinations: [
                    { addr: '0x1006', type: 'CONDITIONAL_JUMP' },
                    { addr: '0x1003', type: 'FALL_THROUGH' },
                ],
            },
            {
                start: '0x1003', end: '0x1004',
                instructions: [instruction('0x1003', 'MOV', 'EAX, 0x0'), instruction('0x1004', 'RET', '')],
                destinations: [],
            },
            {
                start: '0x1006', end: '0x1007',
                instructions: [instruction('0x1006', 'MOV', 'EAX, 0x1'), instruction('0x1007', 'RET', '')],
                destinations: [],
            },
        ],
    };
    const lifter = new Lifter({ importMemory: true, memoryPages: 1 });
    lifter.prepareModule([fn]);
    lifter.liftFunction(fn);
    lifter.moduleBuilder.addExport('test_sign_branch', 0, 0);
    const bridge = new RuntimeBridge({ memory: new WebAssembly.Memory({ initial: 1 }) });
    const instance = new WebAssembly.Instance(new WebAssembly.Module(lifter.moduleBuilder.toBinary()), bridge.createWasmImports());
    return (instance.exports.test_sign_branch as Function)(0x8000, 0, 0);
}

test('TEST sets SF at the operand width before JGE', () => {
    for (const register of ['BL', 'BX', 'EBX'] as const) {
        expect(testSignBranch(register, 0xffffffff)).toBe(0);
        expect(testSignBranch(register, 0x7f)).toBe(1);
        expect(testSignBranch(register, 0)).toBe(1);
    }
});
