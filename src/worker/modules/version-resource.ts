/**
 * Real PE RT_VERSION extraction and VS_VERSIONINFO parsing.
 *
 * Pure helpers (no System/Mem imports) so they stay unit-testable:
 * - findVersionInImage: locate the RT_VERSION blob in a loaded PE image
 *   (guest memory, RVA == VA offset from the module base).
 * - findVersionInFile: locate the RT_VERSION blob in on-disk PE bytes
 *   (RVA translated to a file offset via section headers).
 * - parseVersionInfo / queryVersionInfo: parse a VS_VERSIONINFO blob and
 *   resolve VerQueryValue sub-blocks ("\\", "\\VarFileInfo\\Translation",
 *   "\\StringFileInfo\\<lang><codepage>\\<key>").
 *
 * Bounds/alignment/UTF-16 handling follows the version-resource layout:
 * each block is WORD wLength (total bytes), WORD wValueLength, WORD wType
 * (0 = binary, 1 = text), a null-terminated UTF-16 key, DWORD padding,
 * the value, DWORD padding, then child blocks. For text values wValueLength
 * counts WORDs including the null terminator (0 for an empty value); for
 * binary values it counts bytes. Never throws on malformed input.
 */

export const RT_VERSION = 16;
export const VS_FIXEDFILEINFO_SIGNATURE = 0xfeef04bd;
export const VS_FIXEDFILEINFO_SIZE = 52;
/** Refuse to treat absurd wLength values as a version blob (typical blobs are a few KB). */
export const MAX_VERSION_BLOB_BYTES = 256 * 1024;

export interface VersionStringValue {
    /** Decoded string ("" when wValueLength is 0). */
    value: string;
    /** Offset of the value UTF-16 data within the blob. */
    valueOffset: number;
    /**
     * wValueLength in WORDs (characters including the null terminator,
     * 0 for an empty value). This matches what VerQueryValue reports in puLen.
     */
    charLen: number;
}

export interface ParsedVersionInfo {
    /** Offset of the VS_FIXEDFILEINFO bytes within the blob. */
    fixedValueOffset: number;
    /** Size of the fixed info value in bytes (normally 52). */
    fixedValueSize: number;
    /** Offset of the LANGANDCODEPAGE array, or -1 when absent. */
    translationValueOffset: number;
    /** Size of the translation array in bytes (multiple of 4). */
    translationValueSize: number;
    /** Key: `${langCodepage.toLowerCase()}:${name.toLowerCase()}`. */
    strings: Map<string, VersionStringValue>;
}

export type VersionQuery =
    | { kind: "fixed"; valueOffset: number; valueSize: number }
    | { kind: "translation"; valueOffset: number; valueSize: number }
    | { kind: "string"; value: string; valueOffset: number; charLen: number };

interface Block {
    wLength: number;
    wValueLength: number;
    wType: number;
    key: string;
    valueOffset: number;
    valueBytes: number;
    childrenStart: number;
    childrenEnd: number;
}

const alignUp = (value: number, align: number): number =>
    (value + align - 1) & ~(align - 1);

function viewOf(data: Uint8Array): DataView {
    return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function readU16(data: Uint8Array, view: DataView, pos: number): number | null {
    if (pos < 0 || pos + 2 > data.length) return null;
    return view.getUint16(pos, true);
}

/** Read a null-terminated UTF-16LE string bounded by `limit`. */
function readKey(
    data: Uint8Array,
    view: DataView,
    pos: number,
    limit: number,
): { key: string; next: number } | null {
    let out = "";
    let cur = pos;
    // Cap key length to avoid pathological scans; real keys are short.
    for (let i = 0; i < 256; i++) {
        if (cur + 2 > limit || cur + 2 > data.length) return null;
        const ch = view.getUint16(cur, true);
        cur += 2;
        if (ch === 0) return { key: out, next: cur };
        out += String.fromCharCode(ch);
    }
    return null;
}

function parseBlock(data: Uint8Array, view: DataView, start: number, end: number): Block | null {
    const wLength = readU16(data, view, start);
    const wValueLength = readU16(data, view, start + 2);
    const wType = readU16(data, view, start + 4);
    if (wLength === null || wValueLength === null || wType === null) return null;
    if (wLength < 6 || wType > 1) return null;
    if (start + wLength > end || start + wLength > data.length) return null;

    const blockEnd = start + wLength;
    const key = readKey(data, view, start + 6, blockEnd);
    if (!key) return null;

    const valueOffset = start + alignUp(key.next - start, 4);
    const valueBytes = wType === 1 ? wValueLength * 2 : wValueLength;
    if (valueOffset + valueBytes > blockEnd) return null;

    // Leaf blocks (e.g. odd-sized String entries) carry their trailing DWORD
    // padding outside wLength — halo2.exe's FileDescription entry ends at
    // blockEnd with its sibling padding beyond it. Treat that slop as
    // childless rather than malformed.
    let childrenStart = start + alignUp(valueOffset + valueBytes - start, 4);
    if (childrenStart > blockEnd) {
        if (childrenStart > start + alignUp(wLength, 4)) return null;
        childrenStart = blockEnd;
    }

    return {
        wLength,
        wValueLength,
        wType,
        key: key.key,
        valueOffset,
        valueBytes,
        childrenStart,
        childrenEnd: blockEnd,
    };
}

/** Iterate direct child blocks; stops on the first malformed entry. */
function forEachChild(
    data: Uint8Array,
    view: DataView,
    start: number,
    end: number,
    visit: (block: Block) => void,
): void {
    // Sibling blocks start DWORD-aligned: wLength itself is the exact block
    // size (often not a multiple of 4, e.g. StringFileInfo wLength 1006 in
    // halo2.exe), followed by up to 3 padding bytes before the next sibling.
    let pos = start;
    while (pos + 6 <= end) {
        const child = parseBlock(data, view, pos, end);
        if (!child || child.wLength < 6) return;
        visit(child);
        const next = pos + alignUp(child.wLength, 4);
        if (next <= pos || next > end) return;
        pos = next;
    }
}

function decodeUtf16(data: Uint8Array, view: DataView, offset: number, words: number): string {
    let out = "";
    for (let i = 0; i < words; i++) {
        const pos = offset + i * 2;
        if (pos + 2 > data.length) break;
        const ch = view.getUint16(pos, true);
        if (ch === 0) break;
        out += String.fromCharCode(ch);
    }
    return out;
}

/**
 * Parse a VS_VERSIONINFO blob. Returns null when the root block is missing,
 * truncated, or misaligned. Unknown child blocks are skipped, not fatal.
 */
export function parseVersionInfo(blob: Uint8Array): ParsedVersionInfo | null {
    if (!blob || blob.length < 6 || blob.length > MAX_VERSION_BLOB_BYTES) return null;
    const view = viewOf(blob);
    const root = parseBlock(blob, view, 0, blob.length);
    if (!root || root.key !== "VS_VERSION_INFO") return null;
    if (root.wType !== 0 || root.valueBytes < VS_FIXEDFILEINFO_SIZE) return null;
    if (root.valueOffset + VS_FIXEDFILEINFO_SIZE > blob.length) return null;

    const parsed: ParsedVersionInfo = {
        fixedValueOffset: root.valueOffset,
        fixedValueSize: VS_FIXEDFILEINFO_SIZE,
        translationValueOffset: -1,
        translationValueSize: 0,
        strings: new Map(),
    };

    forEachChild(blob, view, root.childrenStart, root.childrenEnd, (section) => {
        const name = section.key.toLowerCase();
        if (name === "stringfileinfo") {
            forEachChild(blob, view, section.childrenStart, section.childrenEnd, (table) => {
                const tableKey = table.key.toLowerCase();
                if (!/^[0-9a-f]{8}$/.test(tableKey)) return;
                forEachChild(blob, view, table.childrenStart, table.childrenEnd, (entry) => {
                    if (entry.wType !== 1) return;
                    const value =
                        entry.wValueLength === 0
                            ? ""
                            : decodeUtf16(blob, view, entry.valueOffset, entry.wValueLength);
                    const mapKey = `${tableKey}:${entry.key.toLowerCase()}`;
                    if (!parsed.strings.has(mapKey)) {
                        parsed.strings.set(mapKey, {
                            value,
                            valueOffset: entry.valueOffset,
                            charLen: entry.wValueLength,
                        });
                    }
                });
            });
        } else if (name === "varfileinfo") {
            forEachChild(blob, view, section.childrenStart, section.childrenEnd, (entry) => {
                if (entry.key.toLowerCase() !== "translation") return;
                if (entry.wType !== 0 || entry.valueBytes % 4 !== 0 || entry.valueBytes === 0) return;
                if (parsed.translationValueOffset === -1) {
                    parsed.translationValueOffset = entry.valueOffset;
                    parsed.translationValueSize = entry.valueBytes;
                }
            });
        }
    });

    return parsed;
}

/**
 * Resolve a VerQueryValue sub-block against parsed version info.
 * Matching is case-insensitive; the lang-codepage component must be 8 hex
 * digits. Returns null when the requested value does not exist.
 */
export function queryVersionInfo(
    parsed: ParsedVersionInfo,
    subBlock: string,
): VersionQuery | null {
    if (!parsed || typeof subBlock !== "string") return null;
    const parts = subBlock.split("\\").filter((p) => p.length > 0);
    if (parts.length === 0) {
        return {
            kind: "fixed",
            valueOffset: parsed.fixedValueOffset,
            valueSize: parsed.fixedValueSize,
        };
    }
    if (parts.length === 2 && parts[0].toLowerCase() === "varfileinfo" && parts[1].toLowerCase() === "translation") {
        if (parsed.translationValueOffset < 0) return null;
        return {
            kind: "translation",
            valueOffset: parsed.translationValueOffset,
            valueSize: parsed.translationValueSize,
        };
    }
    if (
        parts.length === 3 &&
        parts[0].toLowerCase() === "stringfileinfo" &&
        /^[0-9a-fA-F]{8}$/.test(parts[1])
    ) {
        const entry = parsed.strings.get(`${parts[1].toLowerCase()}:${parts[2].toLowerCase()}`);
        if (!entry) return null;
        return { kind: "string", value: entry.value, valueOffset: entry.valueOffset, charLen: entry.charLen };
    }
    return null;
}

interface DirEntry {
    nameOrId: number;
    offsetToData: number;
}

function readDirHeader(view: DataView, length: number, addr: number): { count: number } | null {
    if (addr < 0 || addr + 16 > length) return null;
    const named = view.getUint16(addr + 12, true);
    const ids = view.getUint16(addr + 14, true);
    if (named > 1024 || ids > 1024) return null;
    return { count: named + ids };
}

function readDirEntry(view: DataView, length: number, addr: number): DirEntry | null {
    if (addr < 0 || addr + 8 > length) return null;
    return {
        nameOrId: view.getUint32(addr, true),
        offsetToData: view.getUint32(addr + 4, true),
    };
}

const isNamedEntry = (nameOrId: number): boolean => (nameOrId & 0x80000000) !== 0;
const isSubdir = (offsetToData: number): boolean => (offsetToData & 0x80000000) !== 0;

/** Find a child entry by integer ID in an image-based (VA) resource directory. */
function findImageEntry(
    view: DataView,
    length: number,
    dirBase: number,
    dirAddr: number,
    id: number,
): number | null {
    const header = readDirHeader(view, length, dirAddr);
    if (!header) return null;
    for (let i = 0; i < header.count; i++) {
        const entry = readDirEntry(view, length, dirAddr + 16 + i * 8);
        if (!entry || isNamedEntry(entry.nameOrId)) continue;
        if ((entry.nameOrId & 0xffff) === id) return entry.offsetToData;
    }
    void dirBase;
    return null;
}

/** Read an IMAGE_RESOURCE_DATA_ENTRY from an image (VA addressing). */
function readImageDataEntry(
    view: DataView,
    length: number,
    moduleBase: number,
    resourceBase: number,
    entryOffset: number,
): { dataAddr: number; size: number } | null {
    const addr = resourceBase + (entryOffset & 0x7fffffff);
    if (addr < 0 || addr + 16 > length) return null;
    const dataRva = view.getUint32(addr, true);
    const size = view.getUint32(addr + 4, true);
    if (size === 0 || size > MAX_VERSION_BLOB_BYTES) return null;
    const dataAddr = moduleBase + dataRva;
    if (dataAddr < 0 || dataAddr + size > length) return null;
    return { dataAddr, size };
}

/** Shared PE header validation; returns the resource directory RVA. */
function getResourceDirRva(data: Uint8Array, view: DataView): number | null {
    if (data.length < 0x40 || view.getUint16(0, true) !== 0x5a4d) return null;
    const eLfanew = view.getUint32(0x3c, true);
    if (eLfanew > data.length || eLfanew + 6 > data.length) return null;
    if (view.getUint32(eLfanew, true) !== 0x00004550) return null;
    const optPtr = eLfanew + 24;
    if (optPtr + 116 + 4 > data.length) return null;
    if (view.getUint16(optPtr, true) !== 0x10b) return null;
    const rva = view.getUint32(optPtr + 112, true);
    if (rva === 0) return null;
    return rva;
}

/**
 * Extract the first RT_VERSION blob from a loaded PE image in guest memory.
 * `mem` is the full guest address space and `moduleBase` the image base.
 */
export function findVersionInImage(mem: Uint8Array, moduleBase: number): Uint8Array | null {
    if (!mem || moduleBase <= 0 || moduleBase >= mem.length) return null;
    const view = viewOf(mem);
    // Validate headers at the module base (not at mem offset 0).
    if (view.getUint16(moduleBase, true) !== 0x5a4d) return null;
    if (moduleBase + 0x40 > mem.length) return null;
    const eLfanew = view.getUint32(moduleBase + 0x3c, true);
    const peHeader = moduleBase + eLfanew;
    if (peHeader < 0 || peHeader + 6 > mem.length) return null;
    if (view.getUint32(peHeader, true) !== 0x00004550) return null;
    const optPtr = peHeader + 24;
    if (optPtr + 120 > mem.length) return null;
    if (view.getUint16(optPtr, true) !== 0x10b) return null;
    const resourceRva = view.getUint32(optPtr + 112, true);
    if (resourceRva === 0) return null;

    const resourceBase = moduleBase + resourceRva;
    if (resourceBase < 0 || resourceBase + 16 > mem.length) return null;

    const typeField = findImageEntry(view, mem.length, resourceBase, resourceBase, RT_VERSION);
    if (typeField === null || !isSubdir(typeField)) return null;
    const nameDir = resourceBase + (typeField & 0x7fffffff);
    const nameHeader = readDirHeader(view, mem.length, nameDir);
    if (!nameHeader || nameHeader.count === 0) return null;
    // First ID entry under the type (version resources are usually ID 1).
    let nameField: number | null = null;
    for (let i = 0; i < nameHeader.count; i++) {
        const entry = readDirEntry(view, mem.length, nameDir + 16 + i * 8);
        if (!entry || isNamedEntry(entry.nameOrId)) continue;
        nameField = entry.offsetToData;
        break;
    }
    if (nameField === null || !isSubdir(nameField)) return null;
    const langDir = resourceBase + (nameField & 0x7fffffff);
    const langHeader = readDirHeader(view, mem.length, langDir);
    if (!langHeader || langHeader.count === 0) return null;
    const langEntry = readDirEntry(view, mem.length, langDir + 16);
    if (!langEntry || isSubdir(langEntry.offsetToData)) return null;

    const data = readImageDataEntry(view, mem.length, moduleBase, resourceBase, langEntry.offsetToData);
    if (!data) return null;
    return mem.slice(data.dataAddr, data.dataAddr + data.size);
}

interface Section {
    virtualAddress: number;
    size: number;
    rawPtr: number;
}

function readSections(data: Uint8Array, view: DataView): Section[] | null {
    if (data.length < 0x40) return null;
    const eLfanew = view.getUint32(0x3c, true);
    const numSections = view.getUint16(eLfanew + 6, true);
    const sizeOpt = view.getUint16(eLfanew + 20, true);
    if (numSections > 96) return null;
    const optPtr = eLfanew + 24;
    const sectionPtr = optPtr + sizeOpt;
    const sections: Section[] = [];
    for (let i = 0; i < numSections; i++) {
        const ptr = sectionPtr + i * 40;
        if (ptr + 40 > data.length) return null;
        sections.push({
            virtualAddress: view.getUint32(ptr + 12, true),
            size: Math.max(view.getUint32(ptr + 8, true), view.getUint32(ptr + 16, true)),
            rawPtr: view.getUint32(ptr + 20, true),
        });
    }
    return sections;
}

/** Translate an RVA to a file offset using section headers (or headers area). */
function rvaToOffset(
    data: Uint8Array,
    view: DataView,
    sections: Section[],
    rva: number,
): number | null {
    for (const section of sections) {
        if (section.size === 0) continue;
        if (rva >= section.virtualAddress && rva < section.virtualAddress + section.size) {
            const offset = section.rawPtr + (rva - section.virtualAddress);
            if (offset < 0 || offset > data.length) return null;
            return offset;
        }
    }
    const eLfanew = view.getUint32(0x3c, true);
    const sizeOfHeaders = view.getUint32(eLfanew + 24 + 60, true);
    if (rva < sizeOfHeaders && rva < data.length) return rva;
    return null;
}

/**
 * Extract the first RT_VERSION blob from on-disk PE bytes.
 * Returns a copy of the resource data, or null when absent/malformed.
 */
export function findVersionInFile(file: Uint8Array): Uint8Array | null {
    if (!file || file.length < 0x40) return null;
    const view = viewOf(file);
    const resourceRva = getResourceDirRva(file, view);
    if (resourceRva === null) return null;
    const sections = readSections(file, view);
    if (!sections) return null;
    const toOffset = (rva: number): number | null => rvaToOffset(file, view, sections, rva);

    const resourceOff = toOffset(resourceRva);
    if (resourceOff === null) return null;

    const findEntry = (dirOff: number, id: number): number | null => {
        const header = readDirHeader(view, file.length, dirOff);
        if (!header) return null;
        for (let i = 0; i < header.count; i++) {
            const entry = readDirEntry(view, file.length, dirOff + 16 + i * 8);
            if (!entry || isNamedEntry(entry.nameOrId)) continue;
            if ((entry.nameOrId & 0xffff) === id) return entry.offsetToData;
        }
        return null;
    };
    const firstIdEntry = (dirOff: number): number | null => {
        const header = readDirHeader(view, file.length, dirOff);
        if (!header) return null;
        for (let i = 0; i < header.count; i++) {
            const entry = readDirEntry(view, file.length, dirOff + 16 + i * 8);
            if (!entry || isNamedEntry(entry.nameOrId)) continue;
            return entry.offsetToData;
        }
        return null;
    };

    const typeField = findEntry(resourceOff, RT_VERSION);
    if (typeField === null || !isSubdir(typeField)) return null;
    const typeOff = resourceOff + (typeField & 0x7fffffff);
    if (typeOff + 16 > file.length) return null;

    const nameField = firstIdEntry(typeOff);
    if (nameField === null || !isSubdir(nameField)) return null;
    const langDirOff = resourceOff + (nameField & 0x7fffffff);
    if (langDirOff + 16 + 8 > file.length) return null;
    const langHeader = readDirHeader(view, file.length, langDirOff);
    if (!langHeader || langHeader.count === 0) return null;
    const langEntry = readDirEntry(view, file.length, langDirOff + 16);
    if (!langEntry || isSubdir(langEntry.offsetToData)) return null;

    const dataEntryOff = resourceOff + (langEntry.offsetToData & 0x7fffffff);
    if (dataEntryOff + 16 > file.length) return null;
    const dataRva = view.getUint32(dataEntryOff, true);
    const size = view.getUint32(dataEntryOff + 4, true);
    if (size === 0 || size > MAX_VERSION_BLOB_BYTES) return null;
    const dataOff = toOffset(dataRva);
    if (dataOff === null || dataOff + size > file.length) return null;
    return file.slice(dataOff, dataOff + size);
}
