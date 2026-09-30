import { describe, expect, test } from "bun:test";
import {
    HLE_DENSE_ORDINAL_BASE,
    HLE_EDATA_RVA,
    buildHleExportImage,
} from "../../src/worker/modules/kernel32/hle-image";

// Guest-style manual export walk mirroring halo2.exe sub_413189/sub_41314d:
// MZ -> e_lfanew -> data dir[0] -> export dir -> linear name search ->
// ordinal -> AddressOfFunctions[ordinal-1] + base -> follow JMP rel32.
function guestResolve(image: Uint8Array, base: number, name: string): number | null {
    const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
    const u16 = (off: number): number | null =>
        off >= 0 && off + 2 <= image.length ? view.getUint16(off, true) : null;
    const u32 = (off: number): number | null =>
        off >= 0 && off + 4 <= image.length ? view.getUint32(off, true) >>> 0 : null;
    const readName = (off: number): string | null => {
        let out = "";
        for (let i = 0; i < 256; i++) {
            const ch = u16(off + i * 2);
            if (ch === null) return null;
            if (ch === 0) return out;
            out += String.fromCharCode(ch & 0xff);
        }
        return null;
    };
    // sub_41314d(base, 0): fetch data directory 0.
    if (u16(0) !== 0x5a4d) return null;
    const eLfanew = u32(0x3c);
    if (eLfanew === null) return null;
    if (u32(eLfanew) !== 0x00004550) return null;
    if (u16(eLfanew + 24) !== 0x10b) return null;
    const dirRva = u32(eLfanew + 24 + 96);
    const dirSize = u32(eLfanew + 24 + 100);
    if (!dirRva || !dirSize) return null;
    const dir = dirRva; // memory image: RVA == file offset here
    const numNames = u32(dir + 24);
    const funcs = u32(dir + 28);
    const names = u32(dir + 32);
    const ordinals = u32(dir + 36);
    if (numNames === null || funcs === null || names === null || ordinals === null) return null;
    const want = name.toLowerCase();
    for (let i = 0; i < numNames; i++) {
        const nameRva = u32(names + i * 4);
        if (nameRva === null) return null;
        // Names are stored ANSI (single byte + null); read as such.
        let cand = "";
        for (let k = 0; k < 256; k++) {
            if (nameRva + k >= image.length) return null;
            const ch = image[nameRva + k]!;
            if (ch === 0) break;
            cand += String.fromCharCode(ch);
        }
        if (cand.toLowerCase() !== want) continue;
        const ord = u16(ordinals + i * 2);
        if (ord === null) return null;
        const funcRva = u32(funcs + ord * 4);
        if (funcRva === null || funcRva === 0) return null;
        // halo2.exe sub_413189 rejects forwarded exports, using the directory
        // size returned by sub_41314d (0x4131da..0x4131e7). Do not execute bytes
        // in that range as code: PE defines them as a forwarder string.
        if (funcRva >= dirRva && funcRva < dirRva + dirSize) return null;
        const codeOff = funcRva;
        // Expect JMP rel32 trampoline; follow it like the CPU would.
        if (image[codeOff] !== 0xe9) return null;
        const rel = view.getInt32(codeOff + 1, true);
        return (base + codeOff + 5 + rel) >>> 0;
    }
    return null;
}

describe("hle-image builder", () => {
    test("guest-style walk resolves every export to its stub", () => {
        const base = 0x13400000;
        const entries = [
            { name: "EncodePointer", target: 0x21047a40 },
            { name: "DecodePointer", target: 0x21047820 },
            { name: "IsProcessorFeaturePresent", target: 0x210478b0 },
            { name: "LoadLibraryA", target: 0x21047c00 },
        ];
        const built = buildHleExportImage("kernel32.dll", base, entries);
        for (const e of entries) {
            expect(guestResolve(built.bytes, base, e.name)).toBe(e.target >>> 0);
            expect(guestResolve(built.bytes, base, e.name.toUpperCase())).toBe(e.target >>> 0);
        }
        expect(guestResolve(built.bytes, base, "NoSuchExport")).toBeNull();
    });

    test("callable trampolines are inside the image and outside the forwarder range", () => {
        const base = 0x13400000;
        const built = buildHleExportImage("kernel32.dll", base, [
            { name: "Sleep", target: 0x21040000 },
        ]);
        const view = new DataView(built.bytes.buffer);
        const dirVa = built.exportDirAddr;
        const dirSize = view.getUint32(0x40 + 24 + 100, true);
        for (const tramp of built.trampolines.values()) {
            expect(tramp).toBeGreaterThanOrEqual(dirVa + dirSize);
            expect(tramp + 8).toBeLessThanOrEqual(base + built.bytes.length);
        }
    });

    test("guest rejects executable bytes incorrectly advertised as a forwarder", () => {
        const base = 0x13400000;
        const built = buildHleExportImage("kernel32.dll", base, [
            { name: "EncodePointer", target: 0x21047a40 },
        ]);
        expect(guestResolve(built.bytes, base, "EncodePointer")).toBe(0x21047a40);
        const view = new DataView(built.bytes.buffer);
        // Reproduce the old image layout: the export range included the JMP.
        view.setUint32(0x40 + 24 + 100, built.bytes.length - HLE_EDATA_RVA, true);
        expect(guestResolve(built.bytes, base, "EncodePointer")).toBeNull();
    });

    test("name table supports a case-sensitive PE binary search", () => {
        const built = buildHleExportImage("names.dll", 0x13400000, [
            { name: "aLower", target: 0x21040000 },
            { name: "ZUpper", target: 0x21040010 },
            { name: "BUpper", target: 0x21040020 },
        ]);
        const view = new DataView(built.bytes.buffer);
        const table = view.getUint32(HLE_EDATA_RVA + 32, true);
        const names: string[] = [];
        for (let i = 0; i < 3; i++) {
            const start = view.getUint32(table + i * 4, true);
            const end = built.bytes.indexOf(0, start);
            names.push(new TextDecoder().decode(built.bytes.subarray(start, end)));
        }
        expect(names).toEqual(["BUpper", "ZUpper", "aLower"]);
    });

    test("explicit ordinals kept, rest dense above collision range", () => {
        const built = buildHleExportImage("comctl32.dll", 0x13500000, [
            { name: "InitCommonControls", ordinal: 17, target: 0x21040000 },
            { name: "NewFunc", target: 0x21040010 },
        ]);
        expect(built.ordinals.get("initcommoncontrols")).toBe(17);
        expect(built.ordinals.get("newfunc")!).toBeGreaterThanOrEqual(HLE_DENSE_ORDINAL_BASE);
    });

    test("zero targets skipped, empty set still yields valid headers", () => {
        const empty = buildHleExportImage("empty.dll", 0x13600000, []);
        const view = new DataView(empty.bytes.buffer);
        expect(view.getUint16(0, true)).toBe(0x5a4d);
        expect(view.getUint32(0x40, true)).toBe(0x00004550);
        expect(guestResolve(empty.bytes, 0x13600000, "Anything")).toBeNull();

        const withZero = buildHleExportImage("z.dll", 0x13600000, [
            { name: "Missing", target: 0 },
            { name: "Present", target: 0x21040000 },
        ]);
        expect(guestResolve(withZero.bytes, 0x13600000, "Missing")).toBeNull();
        expect(guestResolve(withZero.bytes, 0x13600000, "Present")).toBe(0x21040000);
    });

    test("duplicate names dedupe, edata section sane", () => {
        const built = buildHleExportImage("dup.dll", 0x13700000, [
            { name: "Foo", target: 0x21040000 },
            { name: "FOO", target: 0x21040010 },
        ]);
        // First wins (explicit-ordinal preference aside, both lack ordinals).
        expect(guestResolve(built.bytes, 0x13700000, "foo")).toBe(0x21040000);
        const view = new DataView(built.bytes.buffer);
        expect(view.getUint16(0x40 + 24, true)).toBe(0x10b);
        expect(view.getUint32(0x40 + 24 + 96, true)).toBe(HLE_EDATA_RVA);
    });
});
