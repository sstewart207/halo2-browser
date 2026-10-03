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
    const memory = new WebAssembly.Memory({initial: 1});
    const bridge = new RuntimeBridge({memory});
    const instance = new WebAssembly.Instance(
        new WebAssembly.Module(lifter.moduleBuilder.toBinary()),
        bridge.createWasmImports()
    );
    const view = new DataView(memory.buffer);
    return {instance, bridge, view};
}

test('STOSB.REP fills buffer with byte value', () => {
    // EAX=0xaa, ECX=5, EDI=0x2000; STOSB.REP; RET
    const {instance, view} = buildFn('test_stosb', [
        ['MOV', 'EAX, 0xaa'],
        ['MOV', 'ECX, 0x5'],
        ['MOV', 'EDI, 0x2000'],
        ['STOSB.REP', ''],
        ['RET', '']
    ]);
    (instance.exports.test_stosb as Function)(0x8000, 0, 0);
    for (let offset = 0; offset < 5; offset++) {
        expect(view.getUint8(0x2000 + offset)).toBe(0xaa);
    }
    expect(view.getUint8(0x2005)).toBe(0); // untouched
});

test('MOVSB.REP copies bytes from ESI to EDI', () => {
    const {instance, view} = buildFn('test_movsb', [
        ['MOV', 'ESI, 0x3000'],
        ['MOV', 'EDI, 0x4000'],
        ['MOV', 'ECX, 0x4'],
        ['MOVSB.REP', ''],
        ['RET', '']
    ]);
    view.setUint32(0x3000, 0x12345678, true);
    (instance.exports.test_movsb as Function)(0x8000, 0, 0);
    expect(view.getUint32(0x4000, true)).toBe(0x12345678);
});

test('SCASB.REPNE finds byte and sets ZF', () => {
    // Search for 0x00 in string "HELLO\0" at 0x5000
    const {instance, view} = buildFn('test_scasb', [
        ['MOV', 'EDI, 0x5000'],
        ['MOV', 'ECX, 0xa'],
        ['XOR', 'EAX, EAX'], // AL = 0
        ['SCASB.REPNE', ''],
        ['SETZ', 'AL'],
        ['RET', '']
    ]);
    const str = 'HELLO\0WORLD';
    for (let i = 0; i < str.length; i++) view.setUint8(0x5000 + i, str.charCodeAt(i));
    const zf = (instance.exports.test_scasb as Function)(0x8000, 0, 0) & 0xff;
    expect(zf).toBe(1);
});
