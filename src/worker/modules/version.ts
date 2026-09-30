/**
 * VERSION.dll implementation backed by real PE RT_VERSION resources.
 *
 * GetFileVersionInfoSize and GetFileVersionInfo resolve the guest filename to
 * the actual version blob: first from the matching loaded PE image in guest
 * memory, otherwise from a synchronous VFS read of the on-disk file parsed
 * with findVersionInFile. VerQueryValue* parses the caller's pBlock blob
 * (copied there by GetFileVersionInfo) and answers the root block,
 * VarFileInfo Translation and StringFileInfo lang-codepage key
 * queries. Anything unresolvable fails with FALSE/0 and a real last-error
 * code instead of fabricated Need For Speed III metadata.
 */

import { IModule } from "../core/module";
import { Process } from "../core/process";
import { ThunkImplementation } from "../core/thunking/thunk-dispatcher";
import { Logger, LogCategory } from "../core/logger";
import { Mem } from "../core/memory/mem-accessor";
import { Marshaler } from "../core/memory/marshaler";
import { System } from "../core/system";
import { encodeAnsi } from "./codepage-utils";
import {
    VS_FIXEDFILEINFO_SIGNATURE,
    VS_FIXEDFILEINFO_SIZE,
    MAX_VERSION_BLOB_BYTES,
    findVersionInFile,
    findVersionInImage,
    parseVersionInfo,
    queryVersionInfo,
} from "./version-resource";

const TRUE = 1;
const FALSE = 0;
const VERSION_STR_BUF_A_SIZE = 0x400;

const ERROR_FILE_NOT_FOUND = 2;
const ERROR_PATH_NOT_FOUND = 3;
const ERROR_INVALID_PARAMETER = 87;
const ERROR_INSUFFICIENT_BUFFER = 122;
const ERROR_RESOURCE_DATA_NOT_FOUND = 1812;

const GENERIC_READ = 0x80000000;
const OPEN_EXISTING = 3;
/** Largest file we will synchronously buffer for version extraction (EXEs are small). */
const MAX_VERSION_FILE_BYTES = 64 * 1024 * 1024;

const readAsciiZ = (mem: Uint8Array, ptr: number, maxChars = 260): string => {
    if (!ptr || ptr < 0 || ptr >= mem.length) return "";
    const out: number[] = [];
    let addr = ptr;
    while (addr < mem.length && mem[addr] !== 0 && out.length < maxChars) {
        out.push(mem[addr]);
        addr++;
    }
    return String.fromCharCode(...out);
};

const readWideZ = (mem: Uint8Array, ptr: number, maxChars = 260): string => {
    if (!ptr || ptr < 0 || ptr + 1 >= mem.length) return "";
    const view = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
    let out = "";
    let addr = ptr;
    for (let i = 0; i < maxChars && addr + 1 < mem.length; i++, addr += 2) {
        const ch = view.getUint16(addr, true);
        if (ch === 0) break;
        out += String.fromCharCode(ch);
    }
    return out;
};

const writeAsciiZ = (addr: number, value: string): number => {
    const bytes = encodeAnsi(value + "\0");
    Mem.writeBytes(addr, bytes);
    return bytes.length;
};

export class Version implements IModule {
    name = "version";
    exports: Record<string, ThunkImplementation> = {};
    private process!: Process;
    private versionStrBufA = 0;
    /** filename key (lowercased) -> extracted version blob. Successes only. */
    private blobCache = new Map<string, Uint8Array>();

    initialize(process: Process): void {
        this.process = process;
        this.versionStrBufA = process.memory.alloc(VERSION_STR_BUF_A_SIZE, "THUNK_DATA", "rw");

        this.exports["GetFileVersionInfoSizeA"] = (ctx, mem, args) =>
            this.getSizeImpl(mem, args[0], args[1], false);
        this.exports["GetFileVersionInfoSizeW"] = (ctx, mem, args) =>
            this.getSizeImpl(mem, args[0], args[1], true);
        this.exports["GetFileVersionInfoSizeExW"] = (ctx, mem, args) =>
            this.getSizeImpl(mem, args[1], args[2], true);
        this.exports["GetFileVersionInfoSizeExA"] = (ctx, mem, args) =>
            this.getSizeImpl(mem, args[1], args[2], false);

        this.exports["GetFileVersionInfoA"] = (ctx, mem, args) =>
            this.getInfoImpl(mem, args[0], args[2], args[3], false);
        this.exports["GetFileVersionInfoW"] = (ctx, mem, args) =>
            this.getInfoImpl(mem, args[0], args[2], args[3], true);
        this.exports["GetFileVersionInfoExW"] = (ctx, mem, args) =>
            this.getInfoImpl(mem, args[1], args[3], args[4], true);

        this.exports["VerQueryValueA"] = (ctx, mem, args) =>
            this.queryImpl(mem, args[0], args[1], args[2], args[3], false);
        this.exports["VerQueryValueW"] = (ctx, mem, args) =>
            this.queryImpl(mem, args[0], args[1], args[2], args[3], true);

        // ExA is an alias for compatibility (flags ignored, like Windows' non-Ex path).
        this.exports["GetFileVersionInfoExA"] = (ctx, mem, args) =>
            this.exports["GetFileVersionInfoA"]!(ctx, mem, [args[1], args[2], args[3], args[4]]);
    }

    reset(): void {
        this.blobCache.clear();
    }

    private setError(code: number): void {
        try {
            System.getInstance().scheduler.setLastError(code);
        } catch {
            /* scheduler unavailable in unit tests */
        }
    }

    /** Match a version-query filename to a loaded PE image base, if any. */
    private moduleBaseForFilename(filename: string): number | null {
        if (!filename) return null;
        const norm = filename.replace(/\//g, "\\").toLowerCase();
        const baseName = norm.split("\\").pop() ?? norm;
        const registry = System.getInstance().process?.moduleRegistry;
        if (registry) {
            for (const mod of registry.getAllModules()) {
                const modPath = mod.path.replace(/\//g, "\\").toLowerCase();
                const modBase = mod.name.toLowerCase();
                if (
                    modPath === norm ||
                    modPath.endsWith(`\\${baseName}`) ||
                    baseName === `${modBase}.exe` ||
                    baseName === `${modBase}.dll`
                ) {
                    return mod.baseAddress;
                }
            }
        }
        const sys = System.getInstance();
        const exePath = sys.executablePath?.replace(/\//g, "\\").toLowerCase();
        if (exePath && (exePath === norm || baseName === sys.executableName?.toLowerCase())) {
            return registry?.getMainExecutableBase() ?? 0x00400000;
        }
        return null;
    }

    /** Synchronously buffer a whole file from VFS (ROM range reads or cached overlay). */
    private readFileBytesSync(filename: string): { data: Uint8Array } | { error: number } {
        const vfs = System.getInstance().fileSystem;
        if (!vfs) return { error: ERROR_FILE_NOT_FOUND };
        let handle: ReturnType<typeof vfs.openSync> = null;
        try {
            handle = vfs.openSync(filename, GENERIC_READ, OPEN_EXISTING);
        } catch {
            return { error: ERROR_FILE_NOT_FOUND };
        }
        if (!handle) {
            return { error: vfs.parentDirectoryExists?.(vfs.resolvePath(filename)) ? ERROR_FILE_NOT_FOUND : ERROR_PATH_NOT_FOUND };
        }
        const size = vfs.getFileSize(handle.path);
        if (size <= 0) return { error: ERROR_RESOURCE_DATA_NOT_FOUND };
        if (size > MAX_VERSION_FILE_BYTES || size > MAX_VERSION_BLOB_BYTES * 512) {
            return { error: ERROR_RESOURCE_DATA_NOT_FOUND };
        }
        const out = new Uint8Array(size);
        let offset = 0;
        while (offset < size) {
            const chunk = handle ? vfs.readSync(handle, size - offset) : null;
            if (!chunk || chunk.length === 0) return { error: ERROR_RESOURCE_DATA_NOT_FOUND };
            out.set(chunk.subarray(0, Math.min(chunk.length, size - offset)), offset);
            offset += chunk.length;
        }
        return { data: out };
    }

    /**
     * Resolve the version blob for a guest filename. Prefers the loaded PE
     * image (exact bytes the guest executes), falls back to the on-disk file.
     */
    private resolveBlob(
        mem: Uint8Array,
        filename: string,
    ): { blob: Uint8Array } | { error: number } {
        const key = filename.replace(/\//g, "\\").toLowerCase();
        const cached = this.blobCache.get(key);
        if (cached) return { blob: cached };

        const moduleBase = this.moduleBaseForFilename(filename);
        if (moduleBase !== null) {
            const fromImage = findVersionInImage(mem, moduleBase);
            if (fromImage) {
                this.blobCache.set(key, fromImage);
                return { blob: fromImage };
            }
        }

        const file = this.readFileBytesSync(filename);
        if ("error" in file) return { error: file.error };
        const blob = findVersionInFile(file.data);
        if (!blob) return { error: ERROR_RESOURCE_DATA_NOT_FOUND };
        this.blobCache.set(key, blob);
        return { blob };
    }

    private readFilename(mem: Uint8Array, ptr: number, wide: boolean): string {
        if (!ptr) return "";
        return wide
            ? Marshaler.readWideString(mem, ptr)
            : Marshaler.readString(mem, ptr);
    }

    private getSizeImpl(mem: Uint8Array, filenamePtr: number, handlePtr: number, wide: boolean): number {
        const tag = wide ? "GetFileVersionInfoSizeW" : "GetFileVersionInfoSizeA";
        if (!filenamePtr) {
            this.setError(ERROR_INVALID_PARAMETER);
            return 0;
        }
        const filename = this.readFilename(mem, filenamePtr, wide);
        if (!filename) {
            this.setError(ERROR_INVALID_PARAMETER);
            return 0;
        }
        const result = this.resolveBlob(mem, filename);
        if ("error" in result) {
            this.setError(result.error);
            Logger.verbose(LogCategory.SYSTEM, `${tag}: file="${filename}" -> no version resource`);
            return 0;
        }
        if (handlePtr !== 0) Mem.writeUint32(handlePtr, 0);
        this.setError(0);
        Logger.verbose(LogCategory.SYSTEM, `${tag}: file="${filename}" -> size=${result.blob.length}`);
        return result.blob.length;
    }

    private getInfoImpl(
        mem: Uint8Array,
        filenamePtr: number,
        len: number,
        dataPtr: number,
        wide: boolean,
    ): number {
        const tag = wide ? "GetFileVersionInfoW" : "GetFileVersionInfoA";
        if (!filenamePtr || !dataPtr) {
            this.setError(ERROR_INVALID_PARAMETER);
            return FALSE;
        }
        const filename = this.readFilename(mem, filenamePtr, wide);
        if (!filename) {
            this.setError(ERROR_INVALID_PARAMETER);
            return FALSE;
        }
        const result = this.resolveBlob(mem, filename);
        if ("error" in result) {
            this.setError(result.error);
            Logger.verbose(LogCategory.SYSTEM, `${tag}: file="${filename}" -> no version resource`);
            return FALSE;
        }
        if ((len >>> 0) < result.blob.length) {
            this.setError(ERROR_INSUFFICIENT_BUFFER);
            Logger.verbose(LogCategory.SYSTEM,
                `${tag}: file="${filename}" buffer too small (len=${len} need=${result.blob.length})`);
            return FALSE;
        }
        const written = Mem.writeBytes(dataPtr, result.blob);
        if (written < result.blob.length) {
            this.setError(ERROR_INSUFFICIENT_BUFFER);
            return FALSE;
        }
        this.setError(0);
        Logger.verbose(LogCategory.SYSTEM, `${tag}: file="${filename}" -> ${result.blob.length} bytes`);
        return TRUE;
    }

    private queryImpl(
        mem: Uint8Array,
        pBlock: number,
        subBlockPtr: number,
        bufferPtr: number,
        lenPtr: number,
        wide: boolean,
    ): number {
        const tag = wide ? "VerQueryValueW" : "VerQueryValueA";
        if (!pBlock || !subBlockPtr || !bufferPtr || !lenPtr) {
            Logger.verbose(LogCategory.SYSTEM, `${tag}: NULL pointer`);
            return FALSE;
        }
        const subBlock = wide ? readWideZ(mem, subBlockPtr, 512) : readAsciiZ(mem, subBlockPtr, 512);
        if (pBlock < 0 || pBlock + 6 > mem.length) return FALSE;
        const view = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
        const wLength = view.getUint16(pBlock, true);
        if (wLength < 6 || wLength > MAX_VERSION_BLOB_BYTES) {
            Logger.verbose(LogCategory.SYSTEM, `${tag}: bad block length ${wLength}`);
            return FALSE;
        }
        if (pBlock + wLength > mem.length) {
            Logger.verbose(LogCategory.SYSTEM, `${tag}: block extends past guest memory`);
            return FALSE;
        }
        const blob = mem.subarray(pBlock, pBlock + wLength);
        const parsed = parseVersionInfo(blob);
        if (!parsed) {
            Logger.verbose(LogCategory.SYSTEM, `${tag}: unparseable version blob`);
            return FALSE;
        }
        if (
            parsed.fixedValueSize < VS_FIXEDFILEINFO_SIZE ||
            view.getUint32(pBlock + parsed.fixedValueOffset, true) !== VS_FIXEDFILEINFO_SIGNATURE
        ) {
            Logger.verbose(LogCategory.SYSTEM, `${tag}: bad VS_FIXEDFILEINFO signature`);
            return FALSE;
        }
        const query = queryVersionInfo(parsed, subBlock);
        if (!query) {
            Logger.verbose(LogCategory.SYSTEM, `${tag}: subBlock="${subBlock}" not found`);
            return FALSE;
        }

        if (query.kind === "fixed" || query.kind === "translation") {
            Mem.writeUint32(bufferPtr, (pBlock + query.valueOffset) >>> 0);
            Mem.writeUint32(lenPtr, query.valueSize);
            Logger.verbose(LogCategory.SYSTEM, `${tag}: subBlock="${subBlock}" -> ${query.kind} len=${query.valueSize}`);
            return TRUE;
        }

        if (!wide) {
            const bytes = writeAsciiZ(this.versionStrBufA, query.value);
            void bytes;
            Mem.writeUint32(bufferPtr, this.versionStrBufA);
            // puLen counts characters; ANSI keeps the 1:1 mapping. Empty
            // values report 0 to match the W behavior (wValueLength 0).
            const chars = query.charLen === 0 ? 0 : encodeAnsi(query.value).length + 1;
            Mem.writeUint32(lenPtr, chars);
            Logger.verbose(LogCategory.SYSTEM, `${tag}: subBlock="${subBlock}" -> "${query.value}"`);
            return TRUE;
        }

        Mem.writeUint32(bufferPtr, (pBlock + query.valueOffset) >>> 0);
        Mem.writeUint32(lenPtr, query.charLen);
        Logger.verbose(LogCategory.SYSTEM, `${tag}: subBlock="${subBlock}" -> len=${query.charLen}`);
        return TRUE;
    }
}
