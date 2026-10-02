/**
 * Large-allocation attribution — the diagnostic that decides "is the guest heap
 * exhausted because the game really needs this much RAM, or because an emulator path
 * over-charges the bucket?".
 *
 * Halo 2 dies at ~72s with `HEAP exhausted at slab boundary` → std::bad_alloc. The
 * obvious suspects (slab arenas, free-list fragmentation, reserve-only VirtualAlloc
 * over-charging, D3D9 managed/default double-backing) are all measurable, and the
 * measurements are what make the fix choice defensible. These tests pin the three
 * pieces of attribution that the measurement depends on:
 *
 *  1. `MemoryManager.alloc(..., tag)` records the caller's free-text tag on the
 *     large-alloc entry — the log stream is lossy, so the fact must live in the record.
 *  2. The entry carries the IN-FLIGHT thunk name published by ThunkDispatcher, so a
 *     block is attributable to the exact WinAPI rather than to a stack frame whose
 *     function name Vite's dev transform infers unreliably.
 *  3. `getBucketStats()` exposes `slabTop`, the downward-growing slab ceiling that is
 *     the real guest ceiling once a slab exists (and the number in the OOM message).
 *
 * They exercise real allocator behavior through the public API — no source-string checks.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AddressSpace } from '../../src/worker/core/memory/address-space';
import { MemoryManager } from '../../src/worker/core/process';
import { System } from '../../src/worker/core/system';
import { exports as kernel32Memory } from '../../src/worker/modules/kernel32/memory';
import { resetHeapSlab } from '../../src/worker/modules/kernel32/memory';

const MEM_COMMIT = 0x1000;
const MEM_RESERVE = 0x2000;

/**
 * 40 MB guest RAM: HEAP bucket is [0x01000000, 0x02400000) = 20 MB, which leaves room
 * for a ≥64KB block (the large-alloc threshold) without needing the slab arena.
 */
function installHeap() {
    const ram = new Uint8Array(0x02800000);
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

describe('large-allocation attribution', () => {
    let previous: any;
    let ram: Uint8Array;
    let memory: MemoryManager;

    beforeEach(() => {
        const installed = installHeap();
        previous = installed.previous;
        ram = installed.ram;
        memory = installed.memory;
    });

    afterEach(() => {
        resetHeapSlab();
        (globalThis as any).__currentThunkName = '';
        System.getInstance().process = previous;
    });

    test('alloc tag is recorded on the large-alloc entry', () => {
        const size = 0x80000; // 512KB — over the 64KB large-alloc threshold
        const addr = memory.alloc(size, 'HEAP', 'rw', 8, 'VirtualAlloc type=0x3000 COMMIT');

        const history = memory.getLargeAllocHistory(addr, 0x1000);
        const entry = history.find(e => e.op === 'alloc' && e.addr === '0x' + addr.toString(16));
        expect(entry).toBeDefined();
        expect(entry!.size).toBe('0x80000');
        expect(entry!.tag).toBe('VirtualAlloc type=0x3000 COMMIT');
    });

    test('tag is consumed once, so it cannot leak onto the next allocation', () => {
        const tagged = memory.alloc(0x80000, 'HEAP', 'rw', 8, 'first-tag');
        const untagged = memory.alloc(0x80000, 'HEAP', 'rw', 8);

        const find = (a: number) =>
            memory.getLargeAllocHistory(a, 0x1000).find(e => e.op === 'alloc' && e.addr === '0x' + a.toString(16));
        expect(find(tagged)!.tag).toBe('first-tag');
        // A subsequent allocation without an explicit tag must NOT inherit the previous
        // one — otherwise every block looks like it came from the same API.
        expect(find(untagged)!.tag).toBe('');
    });

    test('small allocations are not logged even when tagged', () => {
        const small = memory.alloc(64, 'HEAP', 'rw', 8, 'tiny-tag');
        const history = memory.getLargeAllocHistory(small, 0x1000);
        expect(history).toHaveLength(0);
    });

    test('the in-flight thunk name is captured as the API that produced the block', () => {
        (globalThis as any).__currentThunkName = 'kernel32:VirtualAlloc';
        const addr = memory.alloc(0x80000, 'HEAP', 'rw', 8, 'tagged');
        (globalThis as any).__currentThunkName = '';

        const entry = memory
            .getLargeAllocHistory(addr, 0x1000)
            .find(e => e.op === 'alloc' && e.addr === '0x' + addr.toString(16));
        expect(entry).toBeDefined();
        expect(entry!.js).toContain('api=kernel32:VirtualAlloc');
    });

    test('allocations made outside a thunk report a non-thunk API', () => {
        const addr = memory.alloc(0x80000, 'HEAP', 'rw', 8);
        const entry = memory
            .getLargeAllocHistory(addr, 0x1000)
            .find(e => e.op === 'alloc' && e.addr === '0x' + addr.toString(16));
        expect(entry!.js).toContain('api=<not-a-thunk>');
    });

    test('getBucketStats exposes the slab ceiling (slabTop), which is not the limit', () => {
        const before = memory.getBucketStats().find(b => b.kind === 'HEAP')!;
        expect(before.slabTop).toBe(before.limit);

        // Carve a slab arena: it grows DOWN from the limit, so the guest's real ceiling
        // becomes slabTop while `limit` still reports the full bucket.
        const slabBase = memory.allocSlabArena(0x400000);
        const after = memory.getBucketStats().find(b => b.kind === 'HEAP')!;
        expect(after.slabTop).toBe(slabBase);
        expect(after.limit).toBe(before.limit);
        expect(after.slabTop!).toBeLessThan(after.limit);

        // headroom against the slab ceiling, not against the limit
        expect(after.next).toBeGreaterThan(0);
        expect(after.slabTop! - after.next).toBeGreaterThan(0);
    });

    test('kernel32 VirtualAlloc stamps RESERVE-only vs COMMIT on the alloc record', () => {
        const reserveOnly = kernel32Memory['VirtualAlloc']!(
            null as any, ram, [0, 0x80000, MEM_RESERVE, 0x04],
        ) >>> 0;
        expect(reserveOnly).toBeGreaterThan(0);

        const reserveCommit = kernel32Memory['VirtualAlloc']!(
            null as any, ram, [0, 0x80000, MEM_RESERVE | MEM_COMMIT, 0x04],
        ) >>> 0;
        expect(reserveCommit).toBeGreaterThan(0);

        const commitOnly = kernel32Memory['VirtualAlloc']!(
            null as any, ram, [0, 0x80000, MEM_COMMIT, 0x04],
        ) >>> 0;
        expect(commitOnly).toBeGreaterThan(0);

        const tagFor = (addr: number) =>
            memory.getLargeAllocHistory(addr, 0x1000)
                .filter(e => e.op === 'alloc' && e.addr === '0x' + addr.toString(16))
                .map(e => e.tag)
                .join('|');

        expect(tagFor(reserveOnly)).toContain('RESERVE-only');
        expect(tagFor(reserveOnly)).not.toContain('COMMIT');
        expect(tagFor(reserveCommit)).toContain('type=0x3000');
        expect(tagFor(reserveCommit)).toContain('COMMIT');
        expect(tagFor(reserveCommit)).not.toContain('RESERVE-only');
        expect(tagFor(commitOnly)).toContain('type=0x1000');
        expect(tagFor(commitOnly)).toContain('COMMIT');
    });
});
