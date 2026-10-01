/**
 * Lift v86's 2GB guest-RAM clamp at runtime — no vendor edit, no Closure rebuild, no WASM rebuild.
 *
 * ## Why this exists
 *
 * `CPU.create_memory` (vendor/v86/src/cpu.js:1019, minified into build/libv86.mjs) does:
 *
 *     else if((size | 0) < 0) { size = Math.pow(2, 31) - MMAP_BLOCK_SIZE; }
 *     size = ((size - 1) | (MMAP_BLOCK_SIZE - 1)) + 1 | 0;
 *
 * Both lines reason about the guest RAM size with **signed** int32 arithmetic, so any
 * request at or above 2^31 either clamps down to 2^31 - 128KB or wraps negative through
 * the 64KB round-up. Asking for 4GB silently yields 2147352576 — measured, not assumed:
 * a 3GB bundle manifest plus a 3GB EMU_MEMORY_SIZE still produced maxEnd 2147352576.
 *
 * The Rust side has NO such ceiling: `allocate_memory(size: u32)`
 * (vendor/v86/src/rust/cpu/memory.rs:32) takes a u32 and just does
 * `Layout::from_size_align(size as usize, 0x1000)`. The clamp is entirely JS-side, and
 * `memory_size` is a **Uint32Array** (cpu.js:113), which stores 4GB without trouble.
 * `dbg_assert` is compiled out of the release build (0 occurrences in libv86.mjs), so
 * the stock `(size|0) > 0` assertion cannot fire either.
 *
 * So the fix is to reimplement the four lines above the stock code rather than to fork
 * v86. `libv86.mjs` exports `CPU` for exactly this reason.
 *
 * ## What is NOT fixed here
 *
 * The hard ceiling becomes **WebAssembly's**, not ours. Guest RAM lives inside v86's
 * wasm32 linear memory, and wasm32 addresses at most 4GiB — that budget must also hold
 * the WASM runtime's own globals, the JIT's translation tables and everything else. So
 * 4GB of *guest* RAM is not reachable: the practical ceiling is somewhat below that and
 * has to be measured, not assumed. `guestRamCeilingBytes()` states the bound this code
 * can guarantee.
 *
 * Guest addresses at or above 2^31 are still treated as signed int32 by assorted
 * emulator and guest code, so HEAP_HI deliberately stops at 2^31 today
 * (MEM_HEAP_HI_BASE + MEM_HEAP_HI_SIZE). Lifting that is a separate, deliberate change.
 *
 * ## Safety
 *
 * Applied at most once per process, idempotent, and never for sizes the stock path
 * already handles — below the threshold it delegates to the original implementation so
 * the well-tested path stays in charge of every normal-sized boot.
 */

/** Guest-RAM size above which the stock `create_memory` cannot represent the request. */
const STOCK_PATH_MAX = 0x7f000000; // ~2.13GB; keeps well clear of the 2^31 boundary.
/** v86's MMAP_BLOCK_SIZE (src/const.js:106, `1 << MMAP_BLOCK_BITS`). */
const MMAP_BLOCK_SIZE = 0x10000;

/** CPU.create_memory rounds the request up to a 64KB multiple. */
function roundUpToBlock(size: number): number {
    return Math.ceil(size / MMAP_BLOCK_SIZE) * MMAP_BLOCK_SIZE;
}

/**
 * The largest guest RAM this build can promise, in bytes.
 *
 * wasm32 linear memory is capped at 4GiB total, and guest RAM shares it with the WASM
 * runtime. This is a conservative ceiling, not a measured one — measure
 * `state(['memory']).maxEnd` after booting to find the real figure.
 */
export const GUEST_RAM_HARD_CEILING_BYTES = 0xc0000000; // 3GB, deliberately under 4GiB.

let patched = false;

/**
 * `libv86.mjs` really does export `CPU` (`export let {V86, CPU} = module.exports;`), but
 * the vendored `v86.d.ts` only declares `V86`. The submodule is upstream and must stay
 * untouched, so the missing declaration is asserted locally here rather than by editing
 * vendor files. Only the surface this patch uses is described.
 */
export interface V86CpuConstructor {
    prototype: {
        create_memory: (this: any, size: number, minimum_size: number) => unknown;
    };
}

/**
 * Replace `CPU.prototype.create_memory` with a version that can express sizes at or
 * above 2^31. Safe to call more than once; only the first call installs anything.
 *
 * @param CPU the `CPU` constructor exported by libv86.mjs.
 * @returns true if the patch is installed (or was already).
 */
export function liftV86MemoryClamp(CPU: V86CpuConstructor | undefined): boolean {
    if (patched || !CPU || !CPU.prototype) return patched;

    const stock = CPU.prototype.create_memory;
    if (typeof stock !== "function") return false;

    CPU.prototype.create_memory = function (this: any, size: number, minimum_size: number) {
        // Normal boots keep the stock implementation untouched — it is the path every
        // other title exercises, and it has the better comments.
        if (!(size > STOCK_PATH_MAX)) return stock.call(this, size, minimum_size);

        if (size < minimum_size) size = minimum_size;
        // Plain arithmetic, not `|`: bitwise ops are int32 and would wrap above 2^31,
        // which is the very bug being fixed.
        size = roundUpToBlock(size);

        if (this.memory_size[0] !== 0) {
            console.warn("create_memory: expected uninitialised memory; keeping stock behaviour");
            return stock.call(this, size, minimum_size);
        }
        if (size > GUEST_RAM_HARD_CEILING_BYTES) {
            console.warn(
                `create_memory: ${size} exceeds the ${GUEST_RAM_HARD_CEILING_BYTES} ceiling; clamping`
            );
            size = GUEST_RAM_HARD_CEILING_BYTES;
        }

        this.memory_size[0] = size;

        // Rust side, no ceiling: Layout::from_size_align(size as usize, 0x1000).
        const memory_offset = this.allocate_memory(size);

        // Rebuild v86's two views. The stock code goes through `view()` (src/lib.js:17),
        // which is only a cached `new Uint8Array(buffer, offset, length)` behind a Proxy;
        // constructing them directly is equivalent, and `view` is closure-private so it
        // cannot be called from outside the bundle.
        const buffer = this.wasm_memory.buffer;
        this.mem8 = new Uint8Array(buffer, memory_offset, size);
        this.mem32s = new Uint32Array(buffer, memory_offset, size >>> 2);

        return undefined;
    };

    patched = true;
    console.log(`[v86-memory-patch] guest-RAM clamp lifted; ceiling ${GUEST_RAM_HARD_CEILING_BYTES} bytes`);
    return true;
}

/** True once {@link liftV86MemoryClamp} has installed the override. */
export function isV86MemoryClampLifted(): boolean {
    return patched;
}

/** Test seam: forget that the patch was installed. */
export function resetV86MemoryClampPatchForTests(): void {
    patched = false;
}
