import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AddressSpace } from '../../src/worker/core/memory/address-space';
import { MemoryManager } from '../../src/worker/core/process';
import { System } from '../../src/worker/core/system';
import type { FastPathImplementation } from '../../src/worker/core/thunking/thunk-dispatcher';
import {
    exports as kernel32Memory,
    registerFastPathHeapFunctions,
    resetHeapSlab,
} from '../../src/worker/modules/kernel32/memory';

const HEAP_HANDLE = 0x12345678;
const HEAP_ZERO_MEMORY = 0x8;
const ESP = 0x1000;

function installSmallHeap() {
    // 18 MB guest RAM: HEAP bucket starts at 16 MB, so it is 2 MB — under the
    // 4 MB slab arena size, which makes slab install fail and keeps both paths
    // on the pure-JS allocator.
    const ram = new Uint8Array(0x01200000);
    const addressSpace = new AddressSpace(() => ram);
    addressSpace.initializeLayout(ram.length);
    const memory = new MemoryManager(addressSpace);
    memory.refreshLayoutBuckets();
    const process = {
        memory,
        addressSpace,
        getCurrentMemory: () => ram,
        pageTableManager: null,
        lastError: 0,
    };
    const system = System.getInstance();
    const previous = system.process;
    system.process = process as any;
    resetHeapSlab();
    return { ram, memory, process, previous };
}

function heapAlloc(ram: Uint8Array, dwBytes: number, flags = 0): number {
    return kernel32Memory['HeapAlloc']!(null as any, ram, [HEAP_HANDLE, flags, dwBytes]) >>> 0;
}

function heapFree(ram: Uint8Array, ptr: number): number {
    return kernel32Memory['HeapFree']!(null as any, ram, [HEAP_HANDLE, 0, ptr]) >>> 0;
}

function heapSize(ram: Uint8Array, ptr: number): number {
    return kernel32Memory['HeapSize']!(null as any, ram, [HEAP_HANDLE, 0, ptr]) >>> 0;
}

function heapReAlloc(ram: Uint8Array, ptr: number, dwBytes: number): number {
    return kernel32Memory['HeapReAlloc']!(null as any, ram, [HEAP_HANDLE, 0, ptr, dwBytes]) >>> 0;
}

function installFastPaths(): Record<string, FastPathImplementation> {
    const impls: Record<string, FastPathImplementation> = {};
    registerFastPathHeapFunctions({
        registerFastPath(_mod: string, name: string, impl: FastPathImplementation) {
            impls[name] = impl;
        },
    });
    return impls;
}

function fastAlloc(
    impls: Record<string, FastPathImplementation>,
    ram: Uint8Array,
    dwBytes: number,
    flags = 0,
): number {
    const view = new DataView(ram.buffer, ram.byteOffset, ram.byteLength);
    const cpu = { reg32: new Uint32Array(16) };
    cpu.reg32[4] = ESP;
    view.setUint32(ESP + 8, flags, true);
    view.setUint32(ESP + 12, dwBytes, true);
    const result = impls['HeapAlloc']!(cpu, ram, new Uint32Array(ram.buffer), view);
    expect(result).not.toBeNull();
    return (result ?? 0) >>> 0;
}

function fastFree(impls: Record<string, FastPathImplementation>, ram: Uint8Array, ptr: number): number {
    const view = new DataView(ram.buffer, ram.byteOffset, ram.byteLength);
    const cpu = { reg32: new Uint32Array(16) };
    cpu.reg32[4] = ESP;
    view.setUint32(ESP + 12, ptr, true);
    const result = impls['HeapFree']!(cpu, ram, new Uint32Array(ram.buffer), view);
    expect(result).not.toBeNull();
    return (result ?? 0) >>> 0;
}

describe('HeapAlloc zero-byte semantics', () => {
    let previous: any;
    let ram: Uint8Array;
    let memory: MemoryManager;

    beforeEach(() => {
        const installed = installSmallHeap();
        previous = installed.previous;
        ram = installed.ram;
        memory = installed.memory;
    });

    afterEach(() => {
        resetHeapSlab();
        System.getInstance().process = previous;
    });

    test('normal HeapAlloc(0) returns distinct freeable blocks with HeapSize 0', () => {
        const before = memory.getMetrics().currentBytes;
        const a = heapAlloc(ram, 0);
        const b = heapAlloc(ram, 0);
        expect(a).toBeGreaterThan(0);
        expect(b).toBeGreaterThan(0);
        expect(a).not.toBe(b);
        expect(heapSize(ram, a)).toBe(0);
        expect(heapSize(ram, b)).toBe(0);
        expect(memory.getPhysicalSize(a)).toBe(16);
        expect(memory.getMetrics().currentBytes).toBe(before + 32);

        expect(heapFree(ram, a)).toBe(1);
        expect(memory.getSize(a)).toBeUndefined();
        expect(memory.getMetrics().currentBytes).toBe(before + 16);

        const reused = heapAlloc(ram, 0);
        expect(reused).toBeGreaterThan(0);
        expect(heapSize(ram, reused)).toBe(0);
        expect(heapFree(ram, b)).toBe(1);
        expect(heapFree(ram, reused)).toBe(1);
        expect(memory.getMetrics().currentBytes).toBe(before);
    });

    test('fast-path HeapAlloc(0) matches the same unique/free/HeapSize contract', () => {
        const impls = installFastPaths();
        const before = memory.getMetrics().currentBytes;
        const a = fastAlloc(impls, ram, 0);
        const b = fastAlloc(impls, ram, 0);
        expect(a).toBeGreaterThan(0);
        expect(b).toBeGreaterThan(0);
        expect(a).not.toBe(b);
        expect(heapSize(ram, a)).toBe(0);
        expect(heapSize(ram, b)).toBe(0);
        expect(fastFree(impls, ram, a)).toBe(1);
        expect(memory.getSize(a)).toBeUndefined();
        expect(fastFree(impls, ram, b)).toBe(1);
        expect(memory.getMetrics().currentBytes).toBe(before);
    });

    test('nonzero and HEAP_ZERO_MEMORY behavior is preserved on both paths', () => {
        const impls = installFastPaths();
        const p = heapAlloc(ram, 24);
        expect(p).toBeGreaterThan(0);
        expect(heapSize(ram, p)).toBe(32);
        ram.fill(0xaa, p, p + 32);
        expect(heapFree(ram, p)).toBe(1);

        const z = heapAlloc(ram, 24, HEAP_ZERO_MEMORY);
        expect(z).toBeGreaterThan(0);
        expect([...ram.subarray(z, z + 32)].every((b) => b === 0)).toBe(true);
        expect(heapFree(ram, z)).toBe(1);

        const fz = fastAlloc(impls, ram, 16, HEAP_ZERO_MEMORY);
        expect(fz).toBeGreaterThan(0);
        expect([...ram.subarray(fz, fz + 16)].every((b) => b === 0)).toBe(true);
        expect(fastFree(impls, ram, fz)).toBe(1);

        const n = fastAlloc(impls, ram, 40);
        expect(n).toBeGreaterThan(0);
        expect(heapSize(ram, n)).toBe(48);
        expect(fastFree(impls, ram, n)).toBe(1);
    });

    test('HeapReAlloc from a zero-size block copies nothing and frees the old pointer', () => {
        const old = heapAlloc(ram, 0);
        ram.fill(0x5a, old, old + 16);
        const grown = heapReAlloc(ram, old, 96);
        expect(grown).toBeGreaterThan(0);
        expect(grown).not.toBe(old);
        expect(memory.getSize(old)).toBeUndefined();
        expect(heapSize(ram, grown)).toBe(96);
        expect(heapFree(ram, grown)).toBe(1);
    });
});
