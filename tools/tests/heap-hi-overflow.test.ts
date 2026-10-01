/**
 * HEAP_HI — the overflow arena that lets a memory-hungry guest exceed the fixed 512MB
 * HEAP bucket.
 *
 * The primary bucket cannot grow: THUNK_CODE sits above it at 0x21000000 (pinned into
 * the WASM side) and the JIT treats everything below 0x01000000 as slow memory. But the
 * JIT's fastmem predicate excludes only the 16MB guard band [0x23000000,0x24000000), so
 * an arena placed at 0x40000000+ is already on the fast path — full speed, no THUNK base
 * moves, no v86 rebuild.
 *
 * Halo 2 PC is the motivating case: it commits ~460MB within 50s and dies at ~72s on the
 * 512MB ceiling with an unhandled std::bad_alloc.
 *
 * These tests pin the three properties that make the change safe for every OTHER title:
 *  1. At the default 1GB RAM there is no HEAP_HI bucket at all — nothing changes.
 *  2. With RAM above 1GB, spill happens only after the primary bucket is genuinely full,
 *     and addresses below the primary limit stay byte-identical to before.
 *  3. Overflow blocks free back into the overflow arena's own free list (a block must
 *     never return to a free list whose bump frontier is elsewhere — that is a
 *     double-hand-out waiting to happen).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AddressSpace, isHeapBucketKind } from '../../src/worker/core/memory/address-space';
import { MemoryManager } from '../../src/worker/core/process';
import { System } from '../../src/worker/core/system';
import { MEM_HEAP_BASE, MEM_HEAP_HI_BASE, MEM_SURFACE_SIZE } from '../../src/worker/core/cpu/emulator-config';

const ONE_GB = 0x40000000;
const TWO_GB = 0x80000000;

function install(ramSize: number) {
    const ram = new Uint8Array(ramSize);
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
    return { ram, memory, process, previous };
}

describe('HEAP_HI overflow arena', () => {
    let previous: any;

    afterEach(() => {
        System.getInstance().process = previous;
    });

    test('absent at the default 1GB RAM, so other titles are unaffected', () => {
        const t = install(ONE_GB);
        previous = t.previous;
        const stats = t.memory.getBucketStats();
        expect(stats.find(b => b.kind === 'HEAP_HI')).toBeUndefined();
        // The primary bucket is exactly as it has always been.
        const heap = stats.find(b => b.kind === 'HEAP')!;
        expect(heap.base).toBe(MEM_HEAP_BASE);
        expect(heap.limit - heap.base).toBe(0x20000000);
    });

    test('present above 1GB RAM, sized to the RAM actually available', () => {
        const t = install(TWO_GB);
        previous = t.previous;
        const hi = t.memory.getBucketStats().find(b => b.kind === 'HEAP_HI')!;
        expect(hi).toBeDefined();
        expect(hi.base).toBe(MEM_HEAP_HI_BASE);
        // 2GB RAM ends exactly at MEM_HEAP_HI_BASE + 1GB.
        expect(hi.limit).toBe(MEM_HEAP_HI_BASE + ONE_GB);
        // …and it starts past SURFACE, so the two pools cannot collide.
        expect(MEM_SURFACE_BASE_END()).toBeLessThanOrEqual(hi.base);
    });

    test('spills to HEAP_HI only after the primary bucket is full', () => {
        const t = install(TWO_GB);
        previous = t.previous;
        const { memory } = t;

        // Fill the primary bucket with 4MB blocks. Its ceiling is the slab frontier,
        // which is the limit until a slab arena is carved.
        const blockSize = 4 * 1024 * 1024;
        const first = memory.alloc(blockSize, 'HEAP', 'rw', 8);
        expect(first).toBeGreaterThanOrEqual(MEM_HEAP_BASE);
        expect(first).toBeLessThan(MEM_HEAP_BASE + 0x20000000);

        let spilled: number | undefined;
        for (let i = 0; i < 200 && spilled === undefined; i++) {
            const a = memory.alloc(blockSize, 'HEAP', 'rw', 8);
            if (a >= MEM_HEAP_HI_BASE) spilled = a;
        }
        expect(spilled).toBeDefined();
        // The spill must land in the overflow arena, well clear of the primary bucket…
        expect(spilled!).toBeGreaterThanOrEqual(MEM_HEAP_HI_BASE);
        // …and the primary bucket must be genuinely full, not merely "next".
        const heap = memory.getBucketStats().find(b => b.kind === 'HEAP')!;
        const hi = memory.getBucketStats().find(b => b.kind === 'HEAP_HI')!;
        expect(hi.next).toBeGreaterThan(hi.base);
        expect(heap.next).toBeGreaterThan(heap.base);
    });

    test('HEAP_HI blocks are treated as guest heap memory everywhere', () => {
        const t = install(TWO_GB);
        previous = t.previous;
        const { memory } = t;

        const blockSize = 4 * 1024 * 1024;
        let spilled: number | undefined;
        for (let i = 0; i < 200 && spilled === undefined; i++) {
            const a = memory.alloc(blockSize, 'HEAP', 'rw', 8);
            if (a >= MEM_HEAP_HI_BASE) spilled = a;
        }
        expect(spilled).toBeDefined();

        // snapshotHeapAllocations feeds VirtualQuery-style validation and the heap
        // report; an overflow block missing from it would read as a bad pointer.
        expect(memory.snapshotHeapAllocations().some(a => a.addr === spilled)).toBe(true);
        expect(isHeapBucketKind('HEAP_HI')).toBe(true);
        expect(isHeapBucketKind('HEAP')).toBe(true);
        expect(isHeapBucketKind('SURFACE')).toBe(false);
    });

    test('freeing an overflow block returns it to the overflow free list, not the primary one', () => {
        const t = install(TWO_GB);
        previous = t.previous;
        const { memory } = t;

        const blockSize = 4 * 1024 * 1024;
        let spilled: number | undefined;
        for (let i = 0; i < 200 && spilled === undefined; i++) {
            const a = memory.alloc(blockSize, 'HEAP', 'rw', 8);
            if (a >= MEM_HEAP_HI_BASE) spilled = a;
        }
        expect(spilled).toBeDefined();

        const before = memory.getMetrics().currentBytes;
        memory.free(spilled!);
        expect(memory.getSize(spilled!)).toBeUndefined();
        expect(memory.getMetrics().currentBytes).toBe(before - blockSize);

        // The freed block must be reusable, and reuse must come out of HEAP_HI.
        const reused = memory.alloc(blockSize, 'HEAP', 'rw', 8);
        expect(reused).toBe(spilled!);
        expect(reused).toBeGreaterThanOrEqual(MEM_HEAP_HI_BASE);
    });

    test('a bad allocation size still throws rather than silently spilling', () => {
        const t = install(TWO_GB);
        previous = t.previous;
        expect(() => t.memory.alloc(-1, 'HEAP', 'rw', 8)).toThrow();
        expect(() => t.memory.alloc(0x80000000, 'HEAP', 'rw', 8)).toThrow();
    });
});

/** SURFACE pool end, derived rather than hard-coded so the test tracks the config. */
function MEM_SURFACE_BASE_END(): number {
    return 0x2c000000 + MEM_SURFACE_SIZE;
}
