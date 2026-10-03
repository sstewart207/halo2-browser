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

test('CPUID leaf 0 returns GenuineIntel vendor string and max basic leaf', () => {
    // XOR EAX, EAX; CPUID; RET (stores EAX, EBX, ECX, EDX into memory or returns via registers)
    const {instance} = buildFn('test_cpuid_leaf0_ebx', [
        ['XOR', 'EAX, EAX'],
        ['CPUID', ''],
        ['MOV', 'EAX, EBX'],
        ['RET', '']
    ]);
    const ebx = (instance.exports.test_cpuid_leaf0_ebx as Function)(0x8000, 0, 0) >>> 0;
    expect(ebx).toBe(0x756e6547); // "Genu"

    const {instance: iEax} = buildFn('test_cpuid_leaf0_eax', [
        ['XOR', 'EAX, EAX'],
        ['CPUID', ''],
        ['RET', '']
    ]);
    const maxLeaf = (iEax.exports.test_cpuid_leaf0_eax as Function)(0x8000, 0, 0) >>> 0;
    expect(maxLeaf).toBe(1);
});

test('CPUID leaf 1 returns SSE2 feature flag in EDX bit 26', () => {
    const {instance} = buildFn('test_cpuid_leaf1_edx', [
        ['MOV', 'EAX, 0x1'],
        ['CPUID', ''],
        ['MOV', 'EAX, EDX'],
        ['RET', '']
    ]);
    const edx = (instance.exports.test_cpuid_leaf1_edx as Function)(0x8000, 0, 0) >>> 0;
    expect((edx & 0x04000000) >>> 0).toBe(0x04000000); // SSE2 bit
    expect((edx & 0x02000000) >>> 0).toBe(0x02000000); // SSE bit
});

test('MOVAPD moves between XMM registers cleanly', () => {
    const {instance} = buildFn('test_movapd', [
        ['MOVAPD', 'XMM0, XMM1'],
        ['MOV', 'EAX, 0x42'],
        ['RET', '']
    ]);
    const eax = (instance.exports.test_movapd as Function)(0x8000, 0, 0);
    expect(eax).toBe(0x42);
});

test('MOVDQA stores 16-byte aligned vector to memory', () => {
    const {instance, bridge} = buildFn('test_movdqa', [
        ['PXOR', 'XMM0, XMM0'],
        ['MOV', 'EDI, 0x2000'],
        ['MOVDQA', 'xmmword ptr [EDI], XMM0'],
        ['RET', '']
    ]);
    const view = new DataView((bridge as any).memory.buffer);
    view.setUint32(0x2000, 0x11111111, true);
    view.setUint32(0x2004, 0x22222222, true);
    view.setUint32(0x2008, 0x33333333, true);
    view.setUint32(0x200c, 0x44444444, true);
    (instance.exports.test_movdqa as Function)(0x8000, 0, 0);
    expect(view.getFloat32(0x2000, true)).toBe(0);
    expect(view.getFloat32(0x2004, true)).toBe(0);
    expect(view.getFloat32(0x2008, true)).toBe(0);
    expect(view.getFloat32(0x200c, true)).toBe(0);
});

test('STMXCSR and LDMXCSR store and load MXCSR register', () => {
    // STMXCSR [0x2000]; MOV EAX, [0x2000]; RET -> returns 0x1f80 (default)
    const {instance, bridge} = buildFn('test_stmxcsr', [
        ['STMXCSR', 'dword ptr [0x2000]'],
        ['MOV', 'EAX, dword ptr [0x2000]'],
        ['RET', '']
    ]);
    const val = (instance.exports.test_stmxcsr as Function)(0x8000, 0, 0) >>> 0;
    expect(val).toBe(0x1f80);

    // Set new value at 0x2000, LDMXCSR [0x2000], STMXCSR [0x2004], MOV EAX, [0x2004], RET
    const view = new DataView((bridge as any).memory.buffer);
    view.setUint32(0x2000, 0x1f90, true);
    const {instance: iLd} = buildFn('test_ldmxcsr', [
        ['LDMXCSR', 'dword ptr [0x2000]'],
        ['STMXCSR', 'dword ptr [0x2004]'],
        ['MOV', 'EAX, dword ptr [0x2004]'],
        ['RET', '']
    ]);
    const viewLd = new DataView((iLd.exports.memory as WebAssembly.Memory || (bridge as any).memory).buffer);
    // write to iLd's memory at 0x2000
    const valLd = (iLd.exports.test_ldmxcsr as Function)(0x8000, 0, 0) >>> 0;
    expect((iLd.exports.mxcsr as WebAssembly.Global).value).toBe(valLd);
});
