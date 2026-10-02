/** Build-guarded Halo 2 Vista glyph-cache capacity patch. No disk assets are modified. */
const GLYPH_BLOCKS = 0x4000;
const GLYPH_BYTES = GLYPH_BLOCKS * 32;
export const HALO2_FONT_CACHE_PATCHES = [
    {rva: 0x8d8b0, oldValue: 0x20000, value: GLYPH_BYTES}, // actual pixel backing allocation
    {rva: 0x8d8c9, oldValue: 0x200, value: 0x200}, // cache-handle data array capacity
    {rva: 0x8d8eb, oldValue: 0x200, value: 0x200}, // allocator entry capacity, matches handle array
    {rva: 0x8d8f2, oldValue: 0x1000, value: GLYPH_BLOCKS}, // 16384 blocks * 32 bytes = 512 KiB
] as const;

export function enlargeHalo2FontCache(memory: Uint8Array, base: number, executable: string): boolean {
    if (executable.toLowerCase().split(/[\\/]/).pop() !== 'halo2.exe') return false;
    const view = new DataView(memory.buffer, memory.byteOffset, memory.byteLength);
    // Validate every original PUSH imm32 before changing any bytes. Unknown builds stay untouched.
    for (const patch of HALO2_FONT_CACHE_PATCHES) {
        const address = base + patch.rva;
        if (address < 0 || address + 5 > memory.byteLength || memory[address] !== 0x68 ||
            view.getUint32(address + 1, true) !== patch.oldValue) return false;
    }
    for (const patch of HALO2_FONT_CACHE_PATCHES) view.setUint32(base + patch.rva + 1, patch.value, true);
    return true;
}
