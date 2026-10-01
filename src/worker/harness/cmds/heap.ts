/**
 * heapReport(topN?) — WHO is holding the guest HEAP bucket, right now.
 *
 * Built for the Halo 2 "HEAP exhausted at slab boundary" blocker: the bucket is a
 * fixed-size arena whose bump frontier (grows up) meets the slab arena (grows down),
 * so the question is never "did we run out" but "which subsystem ate the bucket".
 * `getMemReport()` (a worker-console-only global) answers the how-much; this answers
 * the who, over RPC, from the page:
 *
 *   buckets   — per-bucket base/limit/bump/live/free + the slab ceiling. When
 *               `slabTop` has eaten down to the bump frontier you get the same
 *               OOM the game hit, with the numbers that produced it.
 *   topAllocs — the largest live HEAP allocations (texture backing, surfaces,
 *               VirtualAlloc commits), biggest first.
 *   sizeHistogram — live MB and block count per size class, across ALL live
 *               allocations. Use this, not topAllocs, to find where the mass is:
 *               topN hides a guest that is holding a gigabyte in thousands of
 *               medium blocks.
 *   largeLive — NET-LIVE ≥64KB blocks from the large-alloc ring, each with the
 *               caller backtrace captured at alloc time. This is the attribution:
 *               which emulator subsystem called the allocation. A block that was
 *               alloc'd and later freed cancels out here instead of looking like a
 *               leak.
 *   totals    — allocation counters (count / current / peak / lifetime bytes).
 *
 * Read-only; safe to call while v86 is running (harness_rpc services between
 * scheduler quanta).
 */

import type { HarnessService } from "../service";
import { proc } from "../serialize";

const MB = 1024 * 1024;

function hx(v: number): string {
    return "0x" + (v >>> 0).toString(16);
}

interface LargeEvent {
    op: string;
    addr: string;
    size: string;
    t: string;
    overlaps: boolean;
    bt: string;
    js: string;
    tag: string;
}

export function registerHeapCommands(svc: HarnessService): void {
    svc.register("heapReport", (args) => {
        const topN = Math.min(Math.max(Number(args[0] ?? 25) | 0, 1), 500);
        const p = proc();
        if (!p) return { error: "no process loaded" };
        const mem = p.memory;

        const stats = (mem.getBucketStats?.() ?? []) as Array<{
            kind: string; base: number; limit: number; next: number; slabTop?: number;
            used: number; liveUsed: number; free: number;
            freeBlocks: number; freeBytes: number;
        }>;
        // The slab arena grows DOWN from the bucket limit, so once it exists it is
        // the guest bump allocator's real ceiling (see allocateInBucket's
        // "HEAP exhausted at slab boundary" throw). Reported here so the OOM can be
        // read off the numbers that produced it. HEAP_HI is the overflow arena that
        // absorbs the spill when the primary bucket is full, so report it too.
        const heapStat = stats.find(s => s.kind === "HEAP");
        const heapHiStat = stats.find(s => s.kind === "HEAP_HI");
        const slabTop = heapStat?.slabTop;

        const buckets = stats.map(s => {
            const total = s.limit - s.base;
            return {
                kind: s.kind,
                range: `${hx(s.base)}..${hx(s.limit)}`,
                totalMB: +(total / MB).toFixed(2),
                bumpMB: +(s.used / MB).toFixed(2),
                liveMB: +(s.liveUsed / MB).toFixed(2),
                fragMB: +((s.used - s.liveUsed) / MB).toFixed(2),
                freeMB: +(s.free / MB).toFixed(2),
                freePct: +(100 * s.free / total).toFixed(1),
                freeBlocks: s.freeBlocks,
                // Room left above the bump frontier. Equal to freeMB until a slab
                // arena exists, after which the slab ceiling (not the limit) is the
                // real ceiling and this is the number that goes to zero at OOM.
                headroomMB: +(((slabTop != null ? slabTop : s.limit) - s.next) / MB).toFixed(2),
            };
        });

        // Largest live HEAP allocations. snapshotHeapAllocations returns
        // {addr,size} newest-first; we only need the size ordering.
        const allocs = (mem.snapshotHeapAllocations?.() ?? []) as Array<{ addr: number; size: number }>;
        const allocsSorted = allocs.slice().sort((a, b) => b.size - a.size);
        const topAllocs = allocsSorted.slice(0, topN).map(a => ({
            addr: hx(a.addr),
            sizeMB: +(a.size / MB).toFixed(3),
            size: a.size,
        }));

        // Size histogram over EVERY live allocation, not just the >=64KB blocks the
        // large-alloc ring records. The top-N list is useless for the real question:
        // when a guest holds ~1.7GB across ~17k blocks with no single block over
        // 128MB, "the biggest ones" says nothing about where the mass is. Buckets
        // answer that directly — if one size class holds most of the MB, that class
        // is the thing to attribute.
        const BUCKETS: Array<[string, number]> = [
            ["<64KB", 64 * 1024],
            ["64KB-256KB", 256 * 1024],
            ["256KB-1MB", 1024 * 1024],
            ["1MB-8MB", 8 * 1024 * 1024],
            [">8MB", Infinity],
        ];
        const hist = BUCKETS.map(([label, lo]) => ({ label, mb: 0, n: 0 }));
        for (const a of allocs) {
            const idx = BUCKETS.findIndex(([, lo]) => a.size < lo);
            const slot = hist[idx === -1 ? hist.length - 1 : idx];
            slot.mb += a.size / MB;
            slot.n += 1;
        }
        const sizeHistogram = hist
            .filter(s => s.n > 0)
            .map(s => ({ label: s.label, mb: +s.mb.toFixed(2), blocks: s.n }));

        // Net-live large (≥64KB) blocks. getLargeAllocHistory with a full-range
        // radius replays the whole ring; a later 'free' for an address cancels
        // the earlier 'alloc' so only blocks still held are reported.
        const raw = (mem.getLargeAllocHistory?.(0, 0x7fffffff) ?? []) as LargeEvent[];
        const live = new Map<string, { size: number; bt: string; js: string; tag: string; t: string; allocs: number; frees: number }>();
        for (const e of raw) {
            const cur = live.get(e.addr);
            const size = parseInt(e.size, 16) || 0;
            if (e.op === "alloc") {
                if (cur) { cur.allocs++; if (cur.frees > 0) cur.frees--; }
                else live.set(e.addr, { size, bt: e.bt, js: e.js, tag: e.tag, t: e.t, allocs: 1, frees: 0 });
            } else if (e.op === "free") {
                if (cur) {
                    cur.frees++;
                    if (cur.frees >= cur.allocs) live.delete(e.addr);
                }
            }
            // 'alias' entries re-record an address without owning it; ignore.
        }
        const largeLive = [...live.entries()]
            .map(([addr, v]) => ({ addr, sizeMB: +(v.size / MB).toFixed(3), size: v.size, t: v.t, bt: v.bt, js: v.js, tag: v.tag }))
            .sort((a, b) => b.size - a.size)
            .slice(0, topN);

        const m = (mem.getMetrics?.() ?? {}) as Record<string, number>;

        // Roll the live large blocks up by which API produced them — the one number that
        // decides between "the guest really needs this much RAM" and "an emulator path is
        // over-charging the bucket".
        //
        // The ring only records blocks >=64KB and only carries 4096 events, so it ROLLS
        // OVER: `largeLive` comes back empty exactly when the guest is deepest into its
        // allocation and you need the answer most. An empty `apiTotals` therefore means
        // "the ring rolled over", NOT "nothing is allocated". `ringRolledOver` says so
        // explicitly so that reading is never mistaken for a clean result — the size
        // histogram and totals are the authoritative numbers; this is attribution only.
        const byApi = new Map<string, { mb: number; n: number }>();
        for (const e of largeLive) {
            const key = (e.tag || (e.js || "").split("|")[0] || "?").trim();
            const cur = byApi.get(key) ?? { mb: 0, n: 0 };
            cur.mb += e.sizeMB;
            cur.n += 1;
            byApi.set(key, cur);
        }
        const apiTotals = [...byApi.entries()]
            .map(([api, v]) => ({ api, mb: +v.mb.toFixed(2), blocks: v.n }))
            .sort((a, b) => b.mb - a.mb);
        // true = the ring filled up, so later allocations evicted earlier ones and the
        // attribution above is incomplete. Blocks evicted are NOT necessarily freed.
        const ringRolledOver = raw.length >= (mem.getLargeAllocRingCapacity?.() ?? 4096);

        return {
            buckets,
            heap: heapStat
                ? {
                    range: `${hx(heapStat.base)}..${hx(heapStat.limit)}`,
                    slabTop: heapStat.slabTop != null ? hx(heapStat.slabTop) : null,
                    bump: hx(heapStat.next),
                    headroomMB: +(((heapStat.slabTop ?? heapStat.limit) - heapStat.next) / MB).toFixed(2),
                }
                : null,
            heapHi: heapHiStat
                ? {
                    range: `${hx(heapHiStat.base)}..${hx(heapHiStat.limit)}`,
                    bump: hx(heapHiStat.next),
                    usedMB: +(heapHiStat.used / MB).toFixed(2),
                    headroomMB: +((heapHiStat.limit - heapHiStat.next) / MB).toFixed(2),
                }
                : null,
            slabTop: slabTop != null ? hx(slabTop) : null,
            topAllocs,
            sizeHistogram,
            largeLive,
            apiTotals,
            ringRolledOver,
            totals: {
                allocations: allocs.length,
                trackedMB: +(allocs.reduce((s, a) => s + a.size, 0) / MB).toFixed(2),
                currentMB: +((m.currentBytes ?? 0) / MB).toFixed(2),
                peakMB: +((m.peakBytes ?? 0) / MB).toFixed(2),
                totalMB: +((m.totalAllocated ?? 0) / MB).toFixed(2),
                largeEvents: raw.length,
            },
        };
    });
}
