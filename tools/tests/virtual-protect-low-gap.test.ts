import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AddressSpace } from '../../src/worker/core/memory/address-space';
import { MemoryManager } from '../../src/worker/core/process';
import { System } from '../../src/worker/core/system';
import { exports as kernel32Memory } from '../../src/worker/modules/kernel32/memory';

const MEM_COMMIT_RESERVE = 0x3000;
const PAGE_EXECUTE_READ = 0x20;
const PAGE_EXECUTE_READWRITE = 0x40;
const ERROR_INVALID_ADDRESS = 487;

// Detours allocates its trampoline region just below the target module (e.g. 0x3f0000 under a
// 0x400000 image) and then probes it with VirtualProtect; a failure aborts the whole transaction.
const TRAMPOLINE_SIZE = 0x10000;
// The allocation map is module-level, so each test uses its own gap range.
const BASE_REGION = 0x003f0000;
const BASE_SUBRANGE = 0x00300000;
const BASE_UNALLOCATED_NEIGHBOUR = 0x00200000;
const OLD_PROTECT_SLOT = 0x2000;

let ram: Uint8Array;
let previousProcess: unknown;
let previousScheduler: unknown;
let lastError = 0;

beforeEach(() => {
    ram = new Uint8Array(0x01200000);
    const addressSpace = new AddressSpace(() => ram);
    addressSpace.initializeLayout(ram.length);
    const memory = new MemoryManager(addressSpace);
    memory.refreshLayoutBuckets();
    const system = System.getInstance() as any;
    previousProcess = system.process;
    previousScheduler = system.scheduler;
    system.process = { memory, addressSpace, getCurrentMemory: () => ram, pageTableManager: null, lastError: 0 };
    lastError = 0;
    system.scheduler = { setLastError: (e: number) => { lastError = e; } };
});

afterEach(() => {
    const system = System.getInstance() as any;
    system.process = previousProcess;
    system.scheduler = previousScheduler;
});

function virtualAlloc(address: number, size: number, flProtect: number): number {
    return kernel32Memory['VirtualAlloc']!(null as any, ram, [address, size, MEM_COMMIT_RESERVE, flProtect]) >>> 0;
}

function virtualProtect(address: number, size: number, flProtect: number): number {
    return kernel32Memory['VirtualProtect']!(null as any, ram, [address, size, flProtect, OLD_PROTECT_SLOT]) >>> 0;
}

function oldProtect(): number {
    return new DataView(ram.buffer).getUint32(OLD_PROTECT_SLOT, true);
}

describe('VirtualProtect on hinted low-gap allocations', () => {
    test('a hinted allocation below the image can be protected and reports its previous protection', () => {
        expect(virtualAlloc(BASE_REGION, TRAMPOLINE_SIZE, PAGE_EXECUTE_READWRITE)).toBe(BASE_REGION);

        expect(virtualProtect(BASE_REGION, TRAMPOLINE_SIZE, PAGE_EXECUTE_READ)).toBe(1);
        expect(oldProtect()).toBe(PAGE_EXECUTE_READWRITE);

        expect(virtualProtect(BASE_REGION, TRAMPOLINE_SIZE, PAGE_EXECUTE_READWRITE)).toBe(1);
        expect(oldProtect()).toBe(PAGE_EXECUTE_READ);
    });

    test('protecting a sub-range of the allocation succeeds', () => {
        expect(virtualAlloc(BASE_SUBRANGE, TRAMPOLINE_SIZE, PAGE_EXECUTE_READWRITE)).toBe(BASE_SUBRANGE);
        expect(virtualProtect(BASE_SUBRANGE + 0x1234, 8, PAGE_EXECUTE_READ)).toBe(1);
    });

    test('an address that was never allocated still fails with ERROR_INVALID_ADDRESS', () => {
        expect(virtualAlloc(BASE_UNALLOCATED_NEIGHBOUR, TRAMPOLINE_SIZE, PAGE_EXECUTE_READWRITE)).toBe(BASE_UNALLOCATED_NEIGHBOUR);
        expect(virtualProtect(BASE_UNALLOCATED_NEIGHBOUR + TRAMPOLINE_SIZE + 0x1000, 0x1000, PAGE_EXECUTE_READ)).toBe(0);
        expect(lastError).toBe(ERROR_INVALID_ADDRESS);
    });
});
