import { describe, expect, test } from "bun:test";
import {
    VS_FIXEDFILEINFO_SIGNATURE,
    VS_FIXEDFILEINFO_SIZE,
    findVersionInFile,
    findVersionInImage,
    parseVersionInfo,
    queryVersionInfo,
} from "../../src/worker/modules/version-resource";

// ---------------------------------------------------------------------------
// Synthetic VS_VERSIONINFO builder (mirrors the on-disk layout, not the impl).
// ---------------------------------------------------------------------------

const pushU16 = (out: number[], v: number): void => {
    out.push(v & 0xff, (v >>> 8) & 0xff);
};

const pushU32 = (out: number[], v: number): void => {
    out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
};

const pushUtf16Z = (out: number[], s: string): void => {
    for (const ch of s) pushU16(out, ch.charCodeAt(0));
    pushU16(out, 0);
};

const padTo4 = (out: number[], base: number): void => {
    while ((out.length - base) % 4 !== 0) out.push(0);
};

/** Text (wType=1) string entry; empty text emits wValueLength 0 with no value. */
const buildString = (key: string, value: string | null): number[] => {
    const out: number[] = [];
    const base = 0;
    pushU16(out, 0); // wLength placeholder
    pushU16(out, value === null ? 0 : value.length + 1);
    pushU16(out, 1);
    pushUtf16Z(out, key);
    padTo4(out, base);
    if (value !== null) {
        pushUtf16Z(out, value);
        padTo4(out, base);
    }
    out[0] = out.length & 0xff;
    out[1] = (out.length >>> 8) & 0xff;
    return out;
};

const buildContainer = (key: string, wType: number, value: number[], children: number[][]): number[] => {
    const out: number[] = [];
    const base = 0;
    pushU16(out, 0);
    pushU16(out, wType === 1 ? 0 : value.length);
    pushU16(out, wType);
    pushUtf16Z(out, key);
    padTo4(out, base);
    for (const b of value) out.push(b);
    padTo4(out, base);
    for (const child of children) {
        for (const b of child) out.push(b);
        // Sibling blocks are DWORD-aligned; wLength stays the exact size.
        padTo4(out, base);
    }
    out[0] = out.length & 0xff;
    out[1] = (out.length >>> 8) & 0xff;
    return out;
};

const buildFixedInfo = (): number[] => {
    const out: number[] = [];
    pushU32(out, VS_FIXEDFILEINFO_SIGNATURE);
    pushU32(out, 0x00010000); // dwStrucVersion
    pushU32(out, 0x00010000); // dwFileVersionMS 1.0
    pushU32(out, 0x00002b72); // dwFileVersionLS (build 11122)
    pushU32(out, 0x00010000); // dwProductVersionMS
    pushU32(out, 0x00002b72); // dwProductVersionLS
    pushU32(out, 0x0000003f); // dwFileFlagsMask
    pushU32(out, 0x00000000); // dwFileFlags
    pushU32(out, 0x00040004); // dwFileOS
    pushU32(out, 0x00000001); // dwFileType (APP)
    pushU32(out, 0x00000000); // dwFileSubtype
    pushU32(out, 0x00000000); // dwFileDateMS
    pushU32(out, 0x00000000); // dwFileDateLS
    return out;
};

/** Halo 2-shaped synthetic blob: 040904B0 table with game filename + version. */
const buildHaloBlob = (): Uint8Array => {
    const strings = [
        buildString("OriginalFilename", "halo2.exe"),
        buildString("ProductVersion", "1.00.00.11122"),
        buildString("CompanyName", "ReactOS Project"),
        buildString("Comments", null), // empty: wValueLength 0
        buildString("FooBar", "Bar"),
    ];
    const table = buildContainer("040904B0", 1, [], strings);
    const stringFileInfo = buildContainer("StringFileInfo", 1, [], [table]);
    const translationValue = [0x09, 0x04, 0xb0, 0x04]; // 0x0409 / 0x04B0
    const translation = buildContainer("Translation", 0, translationValue, []);
    const varFileInfo = buildContainer("VarFileInfo", 1, [], [translation]);
    const root = buildContainer("VS_VERSION_INFO", 0, buildFixedInfo(), [stringFileInfo, varFileInfo]);
    return new Uint8Array(root);
};

// ---------------------------------------------------------------------------
// Minimal PE builders (headers + single .rsrc with an RT_VERSION tree).
// ---------------------------------------------------------------------------

const RSRC_RVA = 0x1000;
const RSRC_RAW = 0x200;

interface BuiltPe {
    file: Uint8Array;
    blobOffset: number;
}

/** Resource tree: root -> RT_VERSION/1 -> lang 0x0409 -> data entry -> blob. */
const buildPeFile = (blob: Uint8Array): BuiltPe => {
    const dirSize = 16 + 8 + 16 + 8 + 16 + 8 + 16; // 3 dirs + 3 entries + data entry
    const blobOffsetInSection = dirSize;
    const sectionSize = dirSize + blob.length;
    const fileSize = RSRC_RAW + sectionSize;
    const file = new Uint8Array(fileSize);
    const view = new DataView(file.buffer);

    file[0] = 0x4d; file[1] = 0x5a; // MZ
    view.setUint32(0x3c, 0x40, true); // e_lfanew
    view.setUint32(0x40, 0x00004550, true); // PE
    // COFF header at 0x44: Machine(2) Sections(2) Time(4) SymTab(4) Syms(4) OptSize(2) Char(2)
    view.setUint16(0x44, 0x014c, true);
    view.setUint16(0x44 + 2, 1, true);
    view.setUint16(0x44 + 16, 0xe0, true); // SizeOfOptionalHeader
    const opt = 0x40 + 24;
    view.setUint16(opt, 0x10b, true);
    view.setUint32(opt + 60, 0x200, true); // SizeOfHeaders
    view.setUint32(opt + 112, RSRC_RVA, true); // Resource RVA
    view.setUint32(opt + 116, sectionSize, true); // Resource size

    const sec = opt + 0xe0;
    for (let i = 0; i < 5; i++) file[sec + i] = ".rsrc".charCodeAt(i);
    view.setUint32(sec + 8, sectionSize, true); // VirtualSize
    view.setUint32(sec + 12, RSRC_RVA, true); // VirtualAddress
    view.setUint32(sec + 16, sectionSize, true); // SizeOfRawData
    view.setUint32(sec + 20, RSRC_RAW, true); // PointerToRawData

    // Resource directory tree (offsets relative to section start).
    let p = RSRC_RAW;
    const dir = (named: number, ids: number): void => {
        view.setUint32(p, 0, true); view.setUint32(p + 4, 0, true);
        view.setUint16(p + 8, 0, true); view.setUint16(p + 10, 0, true);
        view.setUint16(p + 12, named, true); view.setUint16(p + 14, ids, true);
        p += 16;
    };
    const entry = (id: number, toDir: boolean, target: number): void => {
        view.setUint32(p, id, true);
        view.setUint32(p + 4, (toDir ? 0x80000000 : 0) | target, true);
        p += 8;
    };
    const typeDirOff = 16 + 8;
    dir(0, 1); entry(16, true, typeDirOff);
    dir(0, 1); entry(1, true, typeDirOff + 16 + 8);
    dir(0, 1); entry(0x0409, false, typeDirOff + (16 + 8) * 2);
    const dataEntry = p;
    view.setUint32(dataEntry, RSRC_RVA + blobOffsetInSection, true);
    view.setUint32(dataEntry + 4, blob.length, true);
    view.setUint32(dataEntry + 8, 0, true);
    view.setUint32(dataEntry + 12, 0, true);
    file.set(blob, RSRC_RAW + blobOffsetInSection);
    return { file, blobOffset: RSRC_RAW + blobOffsetInSection };
};

/** Loaded-image layout: headers at moduleBase, VA-addressed resource tree. */
const buildImage = (blob: Uint8Array, moduleBase: number): { mem: Uint8Array; blobAddr: number } => {
    const mem = new Uint8Array(moduleBase + 0x3000);
    const view = new DataView(mem.buffer);
    const resRva = 0x1000;
    const resBase = moduleBase + resRva;
    const blobAddr = resBase + 88;

    view.setUint16(moduleBase, 0x5a4d, true);
    view.setUint32(moduleBase + 0x3c, 0x40, true);
    view.setUint32(moduleBase + 0x40, 0x00004550, true);
    const opt = moduleBase + 0x40 + 24;
    view.setUint16(opt, 0x10b, true);
    view.setUint32(opt + 112, resRva, true);

    let p = resBase;
    const dir = (named: number, ids: number): void => {
        view.setUint32(p, 0, true); view.setUint32(p + 4, 0, true);
        view.setUint16(p + 8, 0, true); view.setUint16(p + 10, 0, true);
        view.setUint16(p + 12, named, true); view.setUint16(p + 14, ids, true);
        p += 16;
    };
    const entry = (id: number, toDir: boolean, target: number): void => {
        view.setUint32(p, id, true);
        view.setUint32(p + 4, (toDir ? 0x80000000 : 0) | target, true);
        p += 8;
    };
    dir(0, 1); entry(16, true, 24);
    dir(0, 1); entry(1, true, 48);
    dir(0, 1); entry(0x0409, false, 72);
    view.setUint32(p, (blobAddr - moduleBase) >>> 0, true); // data RVA
    view.setUint32(p + 4, blob.length, true);
    mem.set(blob, blobAddr);
    return { mem, blobAddr };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("version-resource parser", () => {
    test("parses fixed info, translation, and strings", () => {
        const blob = buildHaloBlob();
        const parsed = parseVersionInfo(blob);
        expect(parsed).not.toBeNull();
        expect(parsed!.fixedValueSize).toBe(VS_FIXEDFILEINFO_SIZE);
        const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
        expect(view.getUint32(parsed!.fixedValueOffset, true)).toBe(VS_FIXEDFILEINFO_SIGNATURE);
        expect(parsed!.translationValueSize).toBe(4);
        expect(blob[parsed!.translationValueOffset]).toBe(0x09);
    });

    test("queries mirror Cartographer detect_process_type paths", () => {
        const parsed = parseVersionInfo(buildHaloBlob())!;
        const name = queryVersionInfo(parsed, "\\StringFileInfo\\040904b0\\OriginalFilename");
        expect(name?.kind).toBe("string");
        if (name?.kind === "string") {
            expect(name.value.toLowerCase()).toBe("halo2.exe");
            expect(name.charLen).toBe("halo2.exe".length + 1);
        }
        const version = queryVersionInfo(parsed, "\\StringFileInfo\\040904b0\\ProductVersion");
        expect(version?.kind).toBe("string");
        if (version?.kind === "string") expect(version.value).toBe("1.00.00.11122");

        const root = queryVersionInfo(parsed, "\\");
        expect(root?.kind).toBe("fixed");
        if (root?.kind === "fixed") expect(root.valueSize).toBe(VS_FIXEDFILEINFO_SIZE);

        const translation = queryVersionInfo(parsed, "\\VarFileInfo\\Translation");
        expect(translation?.kind).toBe("translation");
        if (translation?.kind === "translation") expect(translation.valueSize).toBe(4);
    });

    test("string matching is case-insensitive; unknown keys fail", () => {
        const parsed = parseVersionInfo(buildHaloBlob())!;
        expect(queryVersionInfo(parsed, "\\stringfileinfo\\040904B0\\originalfilename")?.kind).toBe("string");
        expect(queryVersionInfo(parsed, "\\StringFileInfo\\040904B0\\NoSuchKey")).toBeNull();
        expect(queryVersionInfo(parsed, "\\StringFileInfo\\040904E4\\OriginalFilename")).toBeNull();
        expect(queryVersionInfo(parsed, "\\StringFileInfo\\040904b0")).toBeNull();
        expect(queryVersionInfo(parsed, "\\Bogus")).toBeNull();
    });

    test("reports ReactOS-style lengths: 15-char string -> 16, empty -> 0", () => {
        const parsed = parseVersionInfo(buildHaloBlob())!;
        const company = queryVersionInfo(parsed, "\\StringFileInfo\\040904B0\\CompanyName");
        expect(company?.kind).toBe("string");
        if (company?.kind === "string") expect(company.charLen).toBe(16);
        const comments = queryVersionInfo(parsed, "\\StringFileInfo\\040904B0\\Comments");
        expect(comments?.kind).toBe("string");
        if (comments?.kind === "string") {
            expect(comments.value).toBe("");
            expect(comments.charLen).toBe(0);
        }
        const foobar = queryVersionInfo(parsed, "\\StringFileInfo\\040904B0\\FooBar");
        if (foobar?.kind === "string") expect(foobar.charLen).toBe(4);
    });

    test("rejects truncated and garbage blobs without throwing", () => {
        const blob = buildHaloBlob();
        expect(parseVersionInfo(blob.subarray(0, 20))).toBeNull();
        expect(parseVersionInfo(new Uint8Array([1, 2, 3, 4, 5, 6]))).toBeNull();
        expect(parseVersionInfo(new Uint8Array(0))).toBeNull();
    });
});

describe("version-resource PE extraction", () => {
    test("findVersionInFile locates the RT_VERSION blob", () => {
        const blob = buildHaloBlob();
        const { file } = buildPeFile(blob);
        const found = findVersionInFile(file);
        expect(found).not.toBeNull();
        expect(found!.length).toBe(blob.length);
        expect(found![0]).toBe(blob[0]);
        const parsed = parseVersionInfo(found!);
        const name = queryVersionInfo(parsed!, "\\StringFileInfo\\040904b0\\OriginalFilename");
        if (name?.kind === "string") expect(name.value).toBe("halo2.exe");
        else throw new Error("string query failed on extracted blob");
    });

    test("findVersionInFile returns null when no version resource exists", () => {
        const blob = buildHaloBlob();
        const { file } = buildPeFile(blob);
        // Corrupt the type entry: RT_VERSION (16) -> RT_ICON (3).
        const view = new DataView(file.buffer);
        view.setUint32(RSRC_RAW + 16, 3, true);
        expect(findVersionInFile(file)).toBeNull();
        expect(findVersionInFile(new Uint8Array(64))).toBeNull();
    });

    test("findVersionInImage locates the blob in a loaded image", () => {
        const blob = buildHaloBlob();
        const moduleBase = 0x1000;
        const { mem } = buildImage(blob, moduleBase);
        const found = findVersionInImage(mem, moduleBase);
        expect(found).not.toBeNull();
        expect(found!.length).toBe(blob.length);
        const parsed = parseVersionInfo(found!);
        expect(parsed).not.toBeNull();
    });

    test("findVersionInImage rejects bad bases without throwing", () => {
        const blob = buildHaloBlob();
        const { mem } = buildImage(blob, 0x1000);
        expect(findVersionInImage(mem, 0)).toBeNull();
        expect(findVersionInImage(mem, mem.length + 0x100)).toBeNull();
        expect(findVersionInImage(new Uint8Array(64), 0x10)).toBeNull();
    });
});

describe("halo2.exe version resource (read-only, skips when absent)", () => {
    test("Actual OriginalFilename/ProductVersion", async () => {
        const candidates = [
            "C:/Games/Halo 2 Project Cartographer/halo2.exe",
            "C:\\Games\\Halo 2 Project Cartographer\\halo2.exe",
        ];
        const fs = await import("node:fs");
        const path = candidates.find((p) => {
            try {
                return fs.existsSync(p);
            } catch {
                return false;
            }
        });
        if (!path) {
            console.log("skip: halo2.exe not present for read-only version check");
            return;
        }
        const bytes = new Uint8Array(fs.readFileSync(path));
        const found = findVersionInFile(bytes);
        expect(found).not.toBeNull();
        const parsed = parseVersionInfo(found!);
        expect(parsed).not.toBeNull();
        const name = queryVersionInfo(parsed!, "\\StringFileInfo\\040904b0\\OriginalFilename");
        expect(name?.kind).toBe("string");
        if (name?.kind === "string") expect(name.value.toLowerCase()).toBe("halo2.exe");
        const product = queryVersionInfo(parsed!, "\\StringFileInfo\\040904b0\\ProductVersion");
        expect(product?.kind).toBe("string");
        if (product?.kind === "string") expect(product.value).toBe("1.00.00.11122");
    });
});
