/**
 * IKnownFolderManager / IKnownFolder (CLSID_KnownFolderManager) backed by the same folder table
 * shell32 uses for CSIDLs. Folder ids resolve to paths; registering, redirecting and shell-item /
 * ID-list access are not modeled and report E_NOTIMPL, which callers of the path APIs tolerate.
 */

import { Process } from "../core/process";
import { System } from "../core/system";
import { Logger, LogCategory } from "../core/logger";
import { Mem } from "../core/memory/mem-accessor";
import { allocateComObject } from "../core/com/com-memory";
import { installComVtable, ComVtableMethod } from "../core/com/install-com-vtable";
import { ThunkImplementation } from "../core/thunking/thunk-dispatcher";
import { getSpecialFolderPath, ensureSpecialFolderPath } from "./shell32";

export const CLSID_KNOWN_FOLDER_MANAGER = "4df0c730-df9d-4ae3-9153-aa6b82e9795a";
export const IID_IKNOWN_FOLDER_MANAGER = "8be2d872-86aa-4d47-b776-32cca40c7018";
const IID_IKNOWN_FOLDER = "3aa7af7e-9b36-420c-a8e3-f77d4674a488";
const IID_IUNKNOWN = "00000000-0000-0000-c000-000000000046";

const S_OK = 0;
const E_NOTIMPL = 0x80004001;
const E_NOINTERFACE = 0x80004002;
const E_POINTER = 0x80004003;
const E_INVALIDARG = 0x80070057;

const KF_CATEGORY_PERUSER = 3;

interface KnownFolder {
    name: string;
    csidl: number; // -1 when there is no CSIDL equivalent
    path: () => string;
}

const documents = () => getSpecialFolderPath(0x05);
const profile = () => System.getInstance().process?.environment.get("USERPROFILE") ?? "C:\\Windows";

/** KNOWNFOLDERID (lowercase, hyphenated) -> definition. */
const KNOWN_FOLDERS = new Map<string, KnownFolder>([
    ["fdd39ad0-238f-46af-adb4-6c85480369c7", { name: "Documents", csidl: 0x05, path: documents }],
    ["4c5c32ff-bb9d-43b0-b5b4-2d72e54eaaa4", { name: "SavedGames", csidl: -1, path: () => `${documents()}\\Saved Games` }],
    ["3eb685db-65f9-4cf6-a03a-e3ef65729f3d", { name: "RoamingAppData", csidl: 0x1a, path: () => getSpecialFolderPath(0x1a) }],
    ["f1b32785-6fba-4fcf-9d55-7b8e7f157091", { name: "LocalAppData", csidl: 0x1c, path: () => getSpecialFolderPath(0x1c) }],
    ["62ab5d82-fdc1-4dc3-a9dd-070d1d495d97", { name: "ProgramData", csidl: 0x23, path: () => `${profile()}\\ProgramData` }],
    ["5e6c858f-0e22-4760-9afe-ea3317b67173", { name: "Profile", csidl: 0x28, path: profile }],
    ["f38bf404-1d43-42f2-9305-67de0b28fc23", { name: "Windows", csidl: 0x24, path: () => getSpecialFolderPath(0x24) }],
    ["1ac14e77-02e7-4e5d-b744-2eb1ae5198b7", { name: "System", csidl: 0x25, path: () => getSpecialFolderPath(0x25) }],
    ["905e63b6-c1bf-494e-b29c-65b732d3d21a", { name: "ProgramFiles", csidl: 0x26, path: () => getSpecialFolderPath(0x26) }],
    ["b4bfcc3a-db2c-424c-b029-7fe99a87c641", { name: "Desktop", csidl: 0x00, path: () => `${profile()}\\Desktop` }],
]);

const readGuid = (mem: Uint8Array, ptr: number): string | null => {
    if (!ptr || ptr + 16 > mem.length) return null;
    const v = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
    const hex = (n: number, w: number) => n.toString(16).padStart(w, "0");
    let tail = "";
    for (let i = 8; i < 16; i++) tail += hex(mem[ptr + i]!, 2);
    return `${hex(v.getUint32(ptr, true), 8)}-${hex(v.getUint16(ptr + 4, true), 4)}-${hex(v.getUint16(ptr + 6, true), 4)}-${tail.slice(0, 4)}-${tail.slice(4)}`;
};

const writeGuid = (mem: Uint8Array, ptr: number, guid: string): void => {
    const v = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
    const parts = guid.split("-");
    v.setUint32(ptr, parseInt(parts[0]!, 16) >>> 0, true);
    v.setUint16(ptr + 4, parseInt(parts[1]!, 16), true);
    v.setUint16(ptr + 6, parseInt(parts[2]!, 16), true);
    const tail = parts[3]! + parts[4]!;
    for (let i = 0; i < 8; i++) mem[ptr + 8 + i] = parseInt(tail.slice(i * 2, i * 2 + 2), 16);
};

interface Instance {
    kind: "manager" | "folder";
    refCount: number;
    folderId?: string;
}

interface Vtables {
    manager: number;
    folder: number;
}

const instances = new Map<number, Instance>();
let vtables: Vtables | null = null;

const FOLDER_METHODS: ComVtableMethod[] = [
    { name: "KF_QueryInterface", argCount: 3, stackCleanupBytes: 12 },
    { name: "KF_AddRef", argCount: 1, stackCleanupBytes: 4 },
    { name: "KF_Release", argCount: 1, stackCleanupBytes: 4 },
    { name: "KF_GetId", argCount: 2, stackCleanupBytes: 8 },
    { name: "KF_GetCategory", argCount: 2, stackCleanupBytes: 8 },
    { name: "KF_GetShellItem", argCount: 4, stackCleanupBytes: 16 },
    { name: "KF_GetPath", argCount: 3, stackCleanupBytes: 12 },
    { name: "KF_SetPath", argCount: 3, stackCleanupBytes: 12 },
    { name: "KF_GetIDList", argCount: 3, stackCleanupBytes: 12 },
    { name: "KF_GetFolderType", argCount: 2, stackCleanupBytes: 8 },
    { name: "KF_GetRedirectionCapabilities", argCount: 2, stackCleanupBytes: 8 },
    { name: "KF_GetFolderDefinition", argCount: 2, stackCleanupBytes: 8 },
];

const MANAGER_METHODS: ComVtableMethod[] = [
    { name: "KFM_QueryInterface", argCount: 3, stackCleanupBytes: 12 },
    { name: "KFM_AddRef", argCount: 1, stackCleanupBytes: 4 },
    { name: "KFM_Release", argCount: 1, stackCleanupBytes: 4 },
    { name: "KFM_FolderIdFromCsidl", argCount: 3, stackCleanupBytes: 12 },
    { name: "KFM_FolderIdToCsidl", argCount: 3, stackCleanupBytes: 12 },
    { name: "KFM_GetFolderIds", argCount: 3, stackCleanupBytes: 12 },
    { name: "KFM_GetFolder", argCount: 3, stackCleanupBytes: 12 },
    { name: "KFM_GetFolderByName", argCount: 3, stackCleanupBytes: 12 },
    { name: "KFM_RegisterFolder", argCount: 3, stackCleanupBytes: 12 },
    { name: "KFM_UnregisterFolder", argCount: 2, stackCleanupBytes: 8 },
    { name: "KFM_FindFolderFromPath", argCount: 4, stackCleanupBytes: 16 },
    { name: "KFM_FindFolderFromIDList", argCount: 3, stackCleanupBytes: 12 },
    { name: "KFM_Redirect", argCount: 8, stackCleanupBytes: 32 },
];

function newFolderObject(process: Process, folderId: string): number {
    const obj = allocateComObject(process.memory, process.getCurrentMemory(), vtables!.folder, "THUNK_DATA");
    instances.set(obj, { kind: "folder", refCount: 1, folderId });
    return obj;
}

function queryInterface(self: number, iid: string | null, ppv: number): number {
    const inst = instances.get(self);
    if (!ppv) return E_POINTER;
    if (!inst || !iid) {
        Mem.writeUint32(ppv, 0);
        return inst ? E_POINTER : E_NOINTERFACE;
    }
    const own = inst.kind === "manager" ? IID_IKNOWN_FOLDER_MANAGER : IID_IKNOWN_FOLDER;
    if (iid === IID_IUNKNOWN || iid === own) {
        inst.refCount++;
        Mem.writeUint32(ppv, self);
        return S_OK;
    }
    Mem.writeUint32(ppv, 0);
    return E_NOINTERFACE;
}

const addRef = (self: number): number => {
    const inst = instances.get(self);
    return inst ? ++inst.refCount : 1;
};

const release = (self: number): number => {
    const inst = instances.get(self);
    if (!inst) return 0;
    if (--inst.refCount <= 0) {
        instances.delete(self);
        return 0;
    }
    return inst.refCount;
};

function installVtables(process: Process): boolean {
    if (vtables) return true;

    const folderHandlers: Record<string, ThunkImplementation> = {
        KF_QueryInterface: (_c, mem, a) => queryInterface(a[0]! >>> 0, readGuid(mem, a[1]! >>> 0), a[2]! >>> 0),
        KF_AddRef: (_c, _m, a) => addRef(a[0]! >>> 0),
        KF_Release: (_c, _m, a) => release(a[0]! >>> 0),
        KF_GetId: (_c, mem, a) => {
            const inst = instances.get(a[0]! >>> 0);
            const out = a[1]! >>> 0;
            if (!inst?.folderId || !out || out + 16 > mem.length) return E_POINTER;
            writeGuid(mem, out, inst.folderId);
            return S_OK;
        },
        KF_GetCategory: (_c, _m, a) => {
            const out = a[1]! >>> 0;
            if (!out) return E_POINTER;
            Mem.writeUint32(out, KF_CATEGORY_PERUSER);
            return S_OK;
        },
        KF_GetShellItem: () => E_NOTIMPL,
        // HRESULT GetPath(DWORD dwFlags, PWSTR* ppszPath) — result is CoTaskMem-allocated.
        KF_GetPath: (_c, mem, a) => {
            const inst = instances.get(a[0]! >>> 0);
            const out = a[2]! >>> 0;
            const folder = inst?.folderId ? KNOWN_FOLDERS.get(inst.folderId) : undefined;
            if (!out || out + 4 > mem.length) return E_POINTER;
            if (!folder) return E_INVALIDARG;
            const path = folder.path();
            ensureSpecialFolderPath(path);
            const proc = System.getInstance().process;
            const buf = proc?.memory.alloc((path.length + 1) * 2) ?? 0;
            if (!buf) return 0x8007000e; // E_OUTOFMEMORY
            const view = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
            for (let i = 0; i < path.length; i++) view.setUint16(buf + i * 2, path.charCodeAt(i), true);
            view.setUint16(buf + path.length * 2, 0, true);
            Mem.writeUint32(out, buf >>> 0);
            Logger.log(LogCategory.COM, `IKnownFolder::GetPath(${folder.name}) -> "${path}"`);
            return S_OK;
        },
        KF_SetPath: () => E_NOTIMPL,
        KF_GetIDList: () => E_NOTIMPL,
        KF_GetFolderType: () => E_NOTIMPL,
        KF_GetRedirectionCapabilities: () => E_NOTIMPL,
        KF_GetFolderDefinition: () => E_NOTIMPL,
    };

    const managerHandlers: Record<string, ThunkImplementation> = {
        KFM_QueryInterface: (_c, mem, a) => queryInterface(a[0]! >>> 0, readGuid(mem, a[1]! >>> 0), a[2]! >>> 0),
        KFM_AddRef: (_c, _m, a) => addRef(a[0]! >>> 0),
        KFM_Release: (_c, _m, a) => release(a[0]! >>> 0),
        KFM_FolderIdFromCsidl: (_c, mem, a) => {
            const csidl = (a[1]! | 0) & 0xff;
            const out = a[2]! >>> 0;
            if (!out || out + 16 > mem.length) return E_POINTER;
            for (const [id, f] of KNOWN_FOLDERS) {
                if (f.csidl === csidl) {
                    writeGuid(mem, out, id);
                    return S_OK;
                }
            }
            return E_INVALIDARG;
        },
        KFM_FolderIdToCsidl: (_c, mem, a) => {
            const id = readGuid(mem, a[1]! >>> 0);
            const out = a[2]! >>> 0;
            const f = id ? KNOWN_FOLDERS.get(id) : undefined;
            if (!out) return E_POINTER;
            if (!f || f.csidl < 0) return E_INVALIDARG;
            Mem.writeUint32(out, f.csidl);
            return S_OK;
        },
        KFM_GetFolderIds: () => E_NOTIMPL,
        // HRESULT GetFolder(REFKNOWNFOLDERID rfid, IKnownFolder** ppkf)
        KFM_GetFolder: (_c, mem, a) => {
            const id = readGuid(mem, a[1]! >>> 0);
            const out = a[2]! >>> 0;
            if (!out) return E_POINTER;
            Mem.writeUint32(out, 0);
            if (!id || !KNOWN_FOLDERS.has(id)) {
                Logger.warn(LogCategory.COM, `IKnownFolderManager::GetFolder: unknown KNOWNFOLDERID ${id}`);
                return E_INVALIDARG;
            }
            Mem.writeUint32(out, newFolderObject(process, id));
            return S_OK;
        },
        KFM_GetFolderByName: (_c, mem, a) => {
            const out = a[2]! >>> 0;
            if (!out) return E_POINTER;
            Mem.writeUint32(out, 0);
            const view = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
            let name = "";
            for (let p = a[1]! >>> 0; p + 2 <= mem.length && name.length < 128; p += 2) {
                const c = view.getUint16(p, true);
                if (c === 0) break;
                name += String.fromCharCode(c);
            }
            for (const [id, f] of KNOWN_FOLDERS) {
                if (f.name.toLowerCase() === name.toLowerCase()) {
                    Mem.writeUint32(out, newFolderObject(process, id));
                    return S_OK;
                }
            }
            return E_INVALIDARG;
        },
        KFM_RegisterFolder: () => E_NOTIMPL,
        KFM_UnregisterFolder: () => E_NOTIMPL,
        KFM_FindFolderFromPath: () => E_NOTIMPL,
        KFM_FindFolderFromIDList: () => E_NOTIMPL,
        KFM_Redirect: () => E_NOTIMPL,
    };

    const folder = installComVtable(process, {
        moduleName: "ole32_known_folder",
        methods: FOLDER_METHODS,
        handlers: folderHandlers,
        logLabel: "IKnownFolder",
    });
    const manager = installComVtable(process, {
        moduleName: "ole32_known_folder_manager",
        methods: MANAGER_METHODS,
        handlers: managerHandlers,
        logLabel: "IKnownFolderManager",
    });
    if (!folder || !manager) return false;
    vtables = { manager: manager.vtableAddr, folder: folder.vtableAddr };
    return true;
}

/** Create the manager object and write it to *ppv; returns an HRESULT. */
export function createKnownFolderManager(process: Process, iid: string, ppv: number): number {
    if (!ppv) return E_POINTER;
    if (iid !== IID_IKNOWN_FOLDER_MANAGER && iid !== IID_IUNKNOWN) {
        Mem.writeUint32(ppv, 0);
        return E_NOINTERFACE;
    }
    if (!installVtables(process)) {
        Mem.writeUint32(ppv, 0);
        return 0x80004005; // E_FAIL
    }
    const obj = allocateComObject(process.memory, process.getCurrentMemory(), vtables!.manager, "THUNK_DATA");
    instances.set(obj, { kind: "manager", refCount: 1 });
    Mem.writeUint32(ppv, obj);
    Logger.log(LogCategory.COM, `IKnownFolderManager: created object at 0x${obj.toString(16)}`);
    return S_OK;
}
