import {test, expect} from 'bun:test';
import {Lifter} from '../recompiler/lifter';
import {RuntimeBridge} from '../recompiler/runtime-bridge';
import type {CFGFunction} from '../recompiler/types';

function buildFn(name: string, instructions: Array<[string, string]>) {
    const ins = (addr: number, mnemonic: string, ops: string) => ({
        addr: `0x${addr.toString(16)}`,
        len: 1,
        mnemonic,
        ops
    });
    const f: CFGFunction = {
        name,
        entry: '0x1000',
        rva: '0x1000',
        size: instructions.length,
        basicBlocks: [
            {
                start: '0x1000',
                end: `0x${(0x1000 + instructions.length).toString(16)}`,
                instructions: instructions.map(([m, ops], idx) => ins(0x1000 + idx, m, ops)),
                destinations: []
            }
        ]
    };
    const lifter = new Lifter({importMemory: true, memoryPages: 1});
    lifter.prepareModule([f]);
    lifter.liftFunction(f);
    lifter.moduleBuilder.addExport(name, 0, 0);
    const bridge = new RuntimeBridge({memory: new WebAssembly.Memory({initial: 1})});
    const instance = new WebAssembly.Instance(
        new WebAssembly.Module(lifter.moduleBuilder.toBinary()),
        bridge.createWasmImports()
    );
    return {instance, bridge};
}

test('PUSHFD pushes EFLAGS with reserved bit 1 set and condition flags', () => {
    // MOV EAX, 0; CMP EAX, 1 (sets CF=1, SF=1, ZF=0); PUSHFD; POP EAX; RET
    const {instance} = buildFn('test_pushfd', [
        ['MOV', 'EAX, 0x0'],
        ['CMP', 'EAX, 0x1'],
        ['PUSHFD', ''],
        ['POP', 'EAX'],
        ['RET', '']
    ]);
    const val = (instance.exports.test_pushfd as Function)(0x8000, 0, 0) >>> 0;
    // Bit 0 (CF) must be 1
    expect(val & 1).toBe(1);
    // Bit 1 (reserved) must be 1
    expect(val & 2).toBe(2);
    // Bit 6 (ZF) must be 0
    expect(val & 0x40).toBe(0);
    // Bit 7 (SF) must be 1
    expect(val & 0x80).toBe(0x80);
});

test('POPFD updates persistent ID bit and condition flags', () => {
    // Exact sequence from __get_sse2_info:
    // PUSHFD; POP EAX; MOV ECX, EAX; XOR EAX, 0x200000; PUSH EAX; POPFD; PUSHFD; POP EDX; SUB EDX, ECX; MOV EAX, EDX; RET
    const {instance} = buildFn('test_id_toggle', [
        ['PUSHFD', ''],
        ['POP', 'EAX'],
        ['MOV', 'ECX, EAX'],
        ['XOR', 'EAX, 0x200000'],
        ['PUSH', 'EAX'],
        ['POPFD', ''],
        ['PUSHFD', ''],
        ['POP', 'EDX'],
        ['SUB', 'EDX, ECX'],
        ['MOV', 'EAX, EDX'],
        ['RET', '']
    ]);
    const diff = (instance.exports.test_id_toggle as Function)(0x8000, 0, 0) >>> 0;
    // ID bit 21 was successfully flipped through POPFD and read back through PUSHFD
    expect(diff).toBe(0x00200000);
});

test('POPFD unpacks condition flags into branch-effective flags', () => {
    // Push 0x40 (ZF=1), POPFD, SETZ AL, RET
    const {instance: iZf} = buildFn('test_popfd_zf', [
        ['PUSH', '0x40'],
        ['POPFD', ''],
        ['SETZ', 'AL'],
        ['RET', '']
    ]);
    expect((iZf.exports.test_popfd_zf as Function)(0x8000, 0, 0) & 0xff).toBe(1);

    // Push 0x800 (OF=1), POPFD, SETO AL, RET
    const {instance: iOf} = buildFn('test_popfd_of', [
        ['PUSH', '0x800'],
        ['POPFD', ''],
        ['SETO', 'AL'],
        ['RET', '']
    ]);
    expect((iOf.exports.test_popfd_of as Function)(0x8000, 0, 0) & 0xff).toBe(1);

    // Push 0x01 (CF=1), POPFD, SETB AL, RET
    const {instance: iCf} = buildFn('test_popfd_cf', [
        ['PUSH', '0x1'],
        ['POPFD', ''],
        ['SETB', 'AL'],
        ['RET', '']
    ]);
    expect((iCf.exports.test_popfd_cf as Function)(0x8000, 0, 0) & 0xff).toBe(1);

    // Push 0x04 (PF=1), POPFD, PUSHFD, POP EAX, RET (PF preserved in bit 2)
    const {instance: iPf} = buildFn('test_popfd_pf', [
        ['PUSH', '0x4'],
        ['POPFD', ''],
        ['PUSHFD', ''],
        ['POP', 'EAX'],
        ['RET', '']
    ]);
    expect(((iPf.exports.test_popfd_pf as Function)(0x8000, 0, 0) >>> 0) & 4).toBe(4);
});
