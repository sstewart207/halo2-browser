import { expect, test } from 'bun:test';
import { Lifter } from '../recompiler/lifter';
import { RuntimeBridge } from '../../src/worker/core/recompiler/runtime-bridge';
import { RecompilerRunner } from '../../src/worker/core/recompiler/recompiler-runner';
import type { CFGFunction } from '../recompiler/types';

test('AOT and HLE share offset guest RAM without modifying emulator prefix', async () => {
    const memory = new WebAssembly.Memory({ initial: 192 });
    const memoryOffset = 0x100000;
    const memoryLength = 160 * 65536;
    const guest = new Uint8Array(memory.buffer, memoryOffset, memoryLength);
    const view = new DataView(guest.buffer, guest.byteOffset, guest.byteLength);
    new Uint8Array(memory.buffer, 0, memoryOffset).fill(0x5a);
    view.setUint32(0x4000, 0x4000, true);
    const instructions = [
        ['MOV', 'ESI, 0x2000'], ['MOV', 'EDI, 0x94'],
        ['MOV', 'dword ptr [ESI], EDI'], ['PUSH', 'ESI'],
        ['CALL', 'dword ptr [0x4000]'], ['RET', ''],
    ].map(([mnemonic, ops], i) => ({addr: `0x${(0x1000 + i * 8).toString(16)}`, len: 8, mnemonic, ops}));
    const fn: CFGFunction = {name: '___tmainCRTStartup', entry: '0x1000', rva: '0x1000', size: 48,
        basicBlocks: [{start: '0x1000', end: '0x1030', destinations: [], instructions}]};
    const lifter = new Lifter({importMemory: true, memoryPages: 160});
    lifter.prepareModule([fn]);
    lifter.liftFunction(fn);
    lifter.moduleBuilder.addExport(fn.name, 0, 0);
    let observedSize = 0;
    const dispatcher = {
        getStubByName: () => ({stackCleanupBytes: 4}),
        getStubByAddress: (addr: number) => addr === 0x4000 ? {dllName: 'kernel32', functionName: 'GetVersionExA'} : null,
        getImplementation: () => (_ctx: unknown, mem: Uint8Array, args: number[]) => {
            expect(mem.byteOffset).toBe(memoryOffset);
            expect(args[0]).toBe(0x2000);
            observedSize = new DataView(mem.buffer, mem.byteOffset, mem.byteLength).getUint32(args[0], true);
            return observedSize === 148 ? 1 : 0;
        },
    };
    const system = {process: {dispatcher, moduleRegistry: {getMainExecutableBase: () => 0x400000}}} as any;
    const result = await new RecompilerRunner().start({system, memory, memoryOffset, memoryLength,
        wasmBytes: lifter.moduleBuilder.toBinary(), stackTop: 0x19ff00, entryName: fn.name});
    expect(result).toBe(1);
    expect(observedSize).toBe(148);
    expect(view.getUint32(0x2000, true)).toBe(148);
    expect(new Uint8Array(memory.buffer, 0, memoryOffset).every(v => v === 0x5a)).toBe(true);
});

test('AOT ABI lookup normalizes .dll suffix and honors dispatcher metadata', () => {
    const memory = new WebAssembly.Memory({initial: 1});
    const bridge = new RuntimeBridge({memory});
    expect(bridge.getStackCleanupBytes('KERNEL32.dll', 'GetProcessHeap')).toBe(0);
    expect(bridge.getStackCleanupBytes('KERNEL32.dll', 'HeapAlloc')).toBe(12);
    const dispatcher = {getStubByName: () => ({stackCleanupBytes: 24})} as any;
    expect(new RuntimeBridge({memory, dispatcher}).getStackCleanupBytes('example.dll', 'Example')).toBe(24);
});

test('AOT stops at termination and rejects unsupported async APIs', () => {
    const memory = new WebAssembly.Memory({initial: 1});
    const bridge = new RuntimeBridge({memory});
    bridge.registerModule('test', {
        stop: () => ({value: 0, terminated: true}),
        asyncCall: () => Promise.resolve(1),
    });
    expect(() => bridge.callApi('test', 'stop', 0x100)).toThrow('process terminated');
    expect(() => bridge.callApi('test', 'asyncCall', 0x100)).toThrow('async API unsupported');
});
