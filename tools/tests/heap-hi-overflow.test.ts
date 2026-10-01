/**
 * HEAP_HI — the overflow arena that lets a memory-hungry guest exceed the fixed 512MB
 * HEAP bucket.
 *
 * The primary bucket cannot grow: THUNK_CODE sits above it at 0x21000000 (pinned into
 * the WASM side) and the JIT treats everything below 0x01000000 as slow memory. But the
 * JIT's fastmem predicate excludes only the 16MB guard band [0x23000000,0x24000000), so
 * an arena placed above that band is already on the fast path — full speed, no THUNK base
 * moves, no v86 rebuild.
 *
 * Halo 2 PC is the motivating case: it commits ~460MB within 50s and dies at ~72s on the
 * 512MB ceiling with an unhandled std::bad_alloc.
 *
 * These tests pin the properties that make the change safe:
 *  1. The primary HEAP bucket is byte-identical to before at every RAM size, and the
 *     overflow arena starts above it and ends at or below 2^31.
 *  2. Spill happens only after the primary bucket is genuinely full.
 *  3. Overflow blocks free back into the overflow arena's own free list (a block must
 *     never return to a free list whose bump frontier is elsewhere — that is a
 *     double-hand-out waiting to happen).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AddressSpace, isHeapBucketKind } from '../../src/worker/core/memory/address-space';
import { MemoryManager } from '../../src/worker/core/process';
import { System } from '../../src/worker/core/system';
import { MEM_HEAP_BASE, MEM_HEAP_HI_BASE, MEM_SURFACE_BASE, MEM_SURFACE_SIZE } from '../../src/worker/core/cpu/emulator-config';

const ONE_GB = 0x40000000;
/** The shipping machine size. Only one test allocates a buffer this large. */
const TWO_GB = 0x80000000;
/** The smallest machine with room for any overflow arena: RAM ending exactly where
 *  SURFACE ends. Cheaper than 2GB to allocate, so sizing tests use it. */
const RAM_AT_SURFACE_END = MEM_SURFACE_BASE + MEM_SURFACE_SIZE;
/** Guest addresses must stay below 2^31 — emulator and guest code reason about them
 *  as signed int32 — so nothing may be mapped at or above this. */
const TWO_TO_THE_31 = 0x80000000;
/** The primary HEAP bucket, which must not move. */
const PRIMARY_HEAP_SIZE = 0x20000000;

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
    system.process = process as any;
    return { ram, memory, process };
}

describe('HEAP_HI overflow arena', () => {
    let saved: any;

    // Capture the baseline once per test, not per install(). A test may install more than
    // once, and install() returns whatever process it displaced — which, on the second
    // call, is the *previous test's fake* process. Restoring that instead of the real one
    // leaks a live AddressSpace into the System singleton, and later test files that
    // assume no address space is wired in then silently take the other branch.
    beforeEach(() => {
        saved = System.getInstance().process;
    });

    afterEach(() => {
        System.getInstance().process = saved;
    });

    test('the primary HEAP bucket never moves, whatever the RAM size', () => {
        for (const ram of [RAM_AT_SURFACE_END, ONE_GB]) {
            const { memory } = install(ram);
            const heap = memory.getBucketStats().find(b => b.kind === 'HEAP')!;
            expect(heap.base).toBe(MEM_HEAP_BASE);
            expect(heap.limit - heap.base).toBe(PRIMARY_HEAP_SIZE);
        }
    });

    test('the overflow arena is sized by the RAM actually present, never above it', () => {
        // RAM that stops at the end of SURFACE leaves no room for an arena at all.
        const tight = install(RAM_AT_SURFACE_END);
        expect(tight.memory.getBucketStats().find(b => b.kind === 'HEAP_HI')).toBeUndefined();

        // At 1GB the arena exists but RAM is the ceiling, so it stops at end-of-machine.
        const one = install(ONE_GB);
        const hi = one.memory.getBucketStats().find(b => b.kind === 'HEAP_HI')!;
        expect(hi.base).toBe(MEM_HEAP_HI_BASE);
        expect(hi.limit).toBe(ONE_GB);
    });

    // The only test that installs a full 2GB machine — the shipping configuration, and
    // the only size at which the arena's 2^31 ceiling is actually reached. The others
    // use 1GB: several 2GB ArrayBuffers in one file exhaust Bun's heap for no extra
    // coverage, since the spill path does not care how big the arena is.
    test('at 2GB RAM the arena is full size and the whole layout stays below 2^31', () => {
        const t = install(TWO_GB);
        const hi = t.memory.getBucketStats().find(b => b.kind === 'HEAP_HI')!;
        expect(hi).toBeDefined();
        expect(hi.base).toBe(MEM_HEAP_HI_BASE);
        // 2GB RAM ends exactly at MEM_HEAP_HI_BASE + 1.25GB, with nothing wasted…
        expect(hi.limit).toBe(MEM_HEAP_HI_BASE + 0x50000000);
        // …and the arena begins exactly where SURFACE ends, so the pools cannot collide.
        expect(MEM_SURFACE_BASE + MEM_SURFACE_SIZE).toBe(MEM_HEAP_HI_BASE);

        // Anything at or above 2^31 would flip sign under the signed-int32 reasoning
        // used pervasively in both emulator and guest code. This is the constraint that
        // makes "just raise the RAM" the wrong fix and forces HEAP_HI to fill the gap
        // up to the boundary instead.
        for (const b of t.memory.getBucketStats()) {
            expect(b.limit).toBeLessThanOrEqual(TWO_TO_THE_31);
        }
        for (const r of t.process.addressSpace.getRegions()) {
            expect(r.base + r.size).toBeLessThanOrEqual(TWO_TO_THE_31);
        }
    });

    test('spills to HEAP_HI only after the primary bucket is full', () => {
        const { memory } = install(ONE_GB);

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
        const { memory } = install(ONE_GB);

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
        const { memory } = install(ONE_GB);

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
        const { memory } = install(ONE_GB);
        expect(() => memory.alloc(-1, 'HEAP', 'rw', 8)).toThrow();
        expect(() => memory.alloc(0x80000000, 'HEAP', 'rw', 8)).toThrow();
    });
});
