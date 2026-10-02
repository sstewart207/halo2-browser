/**
 * Synthetic PE export images for thunked (HLE) modules.
 *
 * Guest code sometimes walks a loaded module's headers by hand instead of
 * calling GetProcAddress — halo2.exe's CRT resolver (sub_413189) parses
 * e_lfanew, the export data directory and the export name/ordinal tables of
 * kernel32.dll, then CALLs the resolved address. Thunked modules historically
 * returned pseudo-bases (e.g. kernel32 = 0x7c800000) with no readable image
 * behind them, so any manual header walk derailed into unmapped memory.
 *
 * buildHleExportImage emits a minimal in-memory PE: DOS + PE/optional headers
 * with an export data directory, plus per-export 8-byte `jmp rel32`
 * trampolines that forward to the real thunk stubs. Trampolines (not raw stub
 * RVAs) keep every resolved address inside the image, but outside the export
 * data-directory range reserved for forwarder strings. Pure and unit-testable:
 * no System/Mem imports.
 */

export interface HleExportEntry {
    /** Export name as the guest will query it (case preserved). */
    name: string;
    /** Real Windows ordinal when known; otherwise assigned densely. */
    ordinal?: number;
    /** Absolute address of the thunk stub to forward to. */
    target: number;
}

/** Dense ordinals start above the usual real-ordinal range to avoid collisions. */
export const HLE_DENSE_ORDINAL_BASE = 0x1000;
/** Section RVA hosting the export directory, tables, names and trampolines. */
export const HLE_EDATA_RVA = 0x1000;
/** Trampoline slot size: E9 rel32 + 3x NOP. */
export const HLE_TRAMPOLINE_SIZE = 8;

export interface BuiltHleImage {
    bytes: Uint8Array;
    /** Absolute address of the export directory (for tests/diagnostics). */
    exportDirAddr: number;
    /** Absolute addresses of trampolines keyed by lowercase name. */
    trampolines: Map<string, number>;
    /** Ordinal assigned per lowercase name. */
    ordinals: Map<string, number>;
}

const writeU16 = (out: number[], v: number): void => {
    out.push(v & 0xff, (v >>> 8) & 0xff);
};

const writeU32 = (out: number[], v: number): void => {
    out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
};

const writeUtf8Z = (out: number[], s: string): void => {
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
    out.push(0);
};

/**
 * Build a minimal executable PE image for a thunked module.
 *
 * @param dllFileName File name reported in the export directory (e.g. "kernel32.dll").
 * @param imageBase Guest address the image will be mapped at.
 * @param entries Resolvable exports. Entries with target 0 are skipped.
 */
export function buildHleExportImage(
    dllFileName: string,
    imageBase: number,
    entries: HleExportEntry[],
): BuiltHleImage {
    const base = imageBase >>> 0;

    // Dedupe by lowercase name; explicit ordinals win ties.
    const byName = new Map<string, HleExportEntry>();
    for (const e of entries) {
        if (!e || !e.name || (e.target >>> 0) === 0) continue;
        const key = e.name.toLowerCase();
        const prev = byName.get(key);
        if (!prev || (prev.ordinal === undefined && e.ordinal !== undefined)) {
            byName.set(key, e);
        }
    }
    // PE name pointers are sorted by the original, case-sensitive ASCII name.
    const names = [...byName.keys()].sort((a, b) => {
        const left = byName.get(a)!.name;
        const right = byName.get(b)!.name;
        return left < right ? -1 : left > right ? 1 : 0;
    });
    const ordinals = new Map<string, number>();
    const used = new Set<number>();
    // Explicit (real) ordinals always win, whatever their value.
    for (const key of names) {
        const ord = byName.get(key)!.ordinal;
        if (ord !== undefined && ord >= 1 && ord <= 0xffff && !used.has(ord)) {
            ordinals.set(key, ord);
            used.add(ord);
        }
    }
    let dense = HLE_DENSE_ORDINAL_BASE;
    for (const key of names) {
        if (!ordinals.has(key)) {
            while (used.has(dense)) dense++;
            ordinals.set(key, dense);
            used.add(dense);
            dense++;
        }
    }
    const maxOrdinal = names.length === 0 ? 0 : Math.max(...ordinals.values());

    // Layout inside .edata (all RVAs relative to image base):
    //   export dir (40) | funcs (4*maxOrd) | names (4*N) | ordinals (2*N)
    //   | dll+export name strings | trampolines (8*N).
    // The export data-directory size ends before the trampolines: a function
    // RVA inside that range denotes a forwarder string, not executable code.
    // edata[] is indexed by .edata-relative offset: tables live at their
    // computed offsets, strings are appended after the padding.
    const edata: number[] = [];
    const exportDirOff = 0;
    const funcsOff = exportDirOff + 40;
    const namesOff = funcsOff + maxOrdinal * 4;
    const ordinalsOff = namesOff + names.length * 4;
    const stringsOff = ordinalsOff + names.length * 2;
    for (let i = 0; i < stringsOff; i++) edata.push(0);
    const stringRvas = new Map<string, number>();
    let cursor = stringsOff;
    const dllNameRva = HLE_EDATA_RVA + cursor;
    writeUtf8Z(edata, dllFileName);
    cursor += dllFileName.length + 1;
    for (const key of names) {
        // Write the ORIGINAL-cased name.
        const original = byName.get(key)!.name;
        stringRvas.set(key, HLE_EDATA_RVA + cursor);
        writeUtf8Z(edata, original);
        cursor += original.length + 1;
    }
    const trampOff = cursor;
    const trampolines = new Map<string, number>();
    for (const key of names) {
        trampolines.set(key, base + HLE_EDATA_RVA + trampOff + trampolines.size * HLE_TRAMPOLINE_SIZE);
    }
    const edataUsed = trampOff + names.length * HLE_TRAMPOLINE_SIZE;

    const out: number[] = [];
    // Pad edata into place (headers live below HLE_EDATA_RVA).
    for (let i = 0; i < HLE_EDATA_RVA + edataUsed; i++) out.push(0);

    const setU16 = (off: number, v: number): void => {
        out[off] = v & 0xff;
        out[off + 1] = (v >>> 8) & 0xff;
    };
    const setU32 = (off: number, v: number): void => {
        out[off] = v & 0xff;
        out[off + 1] = (v >>> 8) & 0xff;
        out[off + 2] = (v >>> 16) & 0xff;
        out[off + 3] = (v >>> 24) & 0xff;
    };
    const setBytes = (off: number, src: number[]): void => {
        for (let i = 0; i < src.length; i++) out[off + i] = src[i] & 0xff;
    };

    // DOS header.
    setU16(0, 0x5a4d);
    setU32(0x3c, 0x40);
    // PE signature + COFF (1 section, 0xE0 optional).
    const pe = 0x40;
    setU32(pe, 0x00004550);
    setU16(pe + 4, 0x014c);
    setU16(pe + 6, 1);
    setU16(pe + 20, 0xe0);
    // Optional header (PE32).
    const opt = pe + 24;
    setU16(opt, 0x10b);
    setU32(opt + 28, base); // ImageBase
    setU32(opt + 56, HLE_EDATA_RVA + edataUsed + 0x1000); // SizeOfImage
    setU32(opt + 60, 0x200); // SizeOfHeaders
    setU32(opt + 92, 16); // NumberOfRvaAndSizes
    setU32(opt + 96, HLE_EDATA_RVA); // DataDirectory[0].RVA (export)
    setU32(opt + 100, trampOff); // Export metadata only; excludes executable stubs.
    // Section header .edata.
    const sec = opt + 0xe0;
    const secName = ".edata";
    for (let i = 0; i < secName.length; i++) out[sec + i] = secName.charCodeAt(i);
    setU32(sec + 8, edataUsed); // VirtualSize
    setU32(sec + 12, HLE_EDATA_RVA); // VirtualAddress
    setU32(sec + 16, edataUsed); // SizeOfRawData
    setU32(sec + 20, HLE_EDATA_RVA); // PointerToRawData (memory image: VA == offset)
    setU32(sec + 36, 0x60000040); // CNT_INITIALIZED_DATA | MEM_EXECUTE | MEM_READ

    // Export directory.
    const dir = HLE_EDATA_RVA + exportDirOff;
    setU32(dir, 0); // Characteristics
    setU32(dir + 4, 0); // TimeDateStamp
    setU16(dir + 8, 0); // MajorVersion
    setU16(dir + 10, 0); // MinorVersion
    setU32(dir + 12, dllNameRva); // Name
    setU32(dir + 16, 1); // Base (ordinal base)
    setU32(dir + 20, maxOrdinal); // NumberOfFunctions
    setU32(dir + 24, names.length); // NumberOfNames
    setU32(dir + 28, HLE_EDATA_RVA + funcsOff); // AddressOfFunctions
    setU32(dir + 32, HLE_EDATA_RVA + namesOff); // AddressOfNames
    setU32(dir + 36, HLE_EDATA_RVA + ordinalsOff); // AddressOfNameOrdinals

    // AddressOfFunctions (indexed by ordinal-1; gaps stay 0).
    const ordinalToTramp = new Map<number, number>();
    for (const key of names) {
        ordinalToTramp.set(ordinals.get(key)!, trampolines.get(key)!);
    }
    for (let ord = 1; ord <= maxOrdinal; ord++) {
        const tramp = ordinalToTramp.get(ord) ?? 0;
        setU32(HLE_EDATA_RVA + funcsOff + (ord - 1) * 4, tramp === 0 ? 0 : (tramp - base) >>> 0);
    }
    // AddressOfNames (sorted) + AddressOfNameOrdinals.
    names.forEach((key, i) => {
        setU32(HLE_EDATA_RVA + namesOff + i * 4, stringRvas.get(key)!);
        setU16(HLE_EDATA_RVA + ordinalsOff + i * 2, ordinals.get(key)! - 1);
    });
    // Name + DLL strings (edata[stringsOff..] holds the string bytes; the
    // tables below stringsOff were written directly and must be preserved).
    setBytes(HLE_EDATA_RVA + stringsOff, edata.slice(stringsOff));
    // Trampolines: E9 rel32 (jmp to the real stub) + NOP sled.
    names.forEach((key, i) => {
        const trampAddr = base + HLE_EDATA_RVA + trampOff + i * HLE_TRAMPOLINE_SIZE;
        const target = byName.get(key)!.target >>> 0;
        const rel = (target - (trampAddr + 5)) | 0;
        const off = HLE_EDATA_RVA + trampOff + i * HLE_TRAMPOLINE_SIZE;
        out[off] = 0xe9;
        out[off + 1] = rel & 0xff;
        out[off + 2] = (rel >>> 8) & 0xff;
        out[off + 3] = (rel >>> 16) & 0xff;
        out[off + 4] = (rel >>> 24) & 0xff;
        out[off + 5] = 0x90;
        out[off + 6] = 0x90;
        out[off + 7] = 0x90;
    });

    return {
        bytes: new Uint8Array(out),
        exportDirAddr: base + HLE_EDATA_RVA + exportDirOff,
        trampolines,
        ordinals,
    };
}
