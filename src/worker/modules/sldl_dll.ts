import { IModule } from "../core/module";
import { Process } from "../core/process";
import { ThunkImplementation } from "../core/thunking/thunk-dispatcher";
import { Logger, LogCategory } from "../core/logger";

/**
 * sldl_dll.dll — HLE replacement for the Windows software-licensing client DLL.
 *
 * Why HLE: the native SLDL_DLL.dll protects its own code with in-place
 * decrypted fragments (push/push/RET4 call into a decryptor at preferred
 * 0x6a31f1, followed by inline encrypted bytes, patched via VirtualProtect),
 * so its code cannot be statically recompiled to WebAssembly. Its DllMain/CRT
 * initializers are exactly what blocked AOT startup at NEWEST-60.
 *
 * Why this is safe for Project Cartographer: a full byte scan of halo2.exe
 * finds the seven SLDL import thunks (0x427642..0x427666) referenced by
 * nothing — no CALL/JMP rel32, no pointer table, no absolute constant — and
 * Ghidra finds no references either. The imports are statically dead; the
 * DLL only needs to "load". These exports exist so the import table binds.
 *
 * Behaviour: any call logs a warning (it would mean the dead-import analysis
 * is wrong), writes conservative empty outputs, and returns S_OK. This is a
 * deliberate substitution, not a licensing implementation.
 */
const S_OK = 0;
const FAKE_HSLC = 0x534c4443; // 'SLDC' — nonzero opaque handle

export class SldlDll implements IModule {
    name = "sldl_dll";
    exports: Record<string, ThunkImplementation> = {};

    initialize(_process: Process): void {
        const write32 = (mem: Uint8Array, addr: number, value: number) => {
            addr >>>= 0;
            if (addr === 0 || addr + 4 > mem.length) return;
            new DataView(mem.buffer, mem.byteOffset, mem.byteLength).setUint32(addr, value >>> 0, true);
        };
        const warn = (name: string, args: number[]) =>
            Logger.warn(LogCategory.SYSTEM,
                `[sldl_dll HLE] ${name}(${args.map(a => "0x" + (a >>> 0).toString(16)).join(", ")}) called — expected dead import; verify caller`);

        // HRESULT SLOpen(HSLC *phSLC)
        this.exports["SLDLOpen"] = (_c, mem, args) => {
            warn("SLDLOpen", args);
            write32(mem, args[0], FAKE_HSLC);
            return S_OK;
        };
        // HRESULT SLGetSLIDList(hSLC, eQueryIdType, pQueryId, eReturnIdType, UINT *pnReturnIds, SLID **ppReturnIds)
        this.exports["SLDLGetSLIDList"] = (_c, mem, args) => {
            warn("SLDLGetSLIDList", args);
            write32(mem, args[4], 0);
            write32(mem, args[5], 0);
            return S_OK;
        };
        // HRESULT SLGetLicensingStatusInformation(hSLC, pAppID, pSkuId, pwszRight, UINT *pnStatusCount, SL_LICENSING_STATUS **pp)
        this.exports["SLDLGetLicensingStatusInformation"] = (_c, mem, args) => {
            warn("SLDLGetLicensingStatusInformation", args);
            write32(mem, args[4], 0);
            write32(mem, args[5], 0);
            return S_OK;
        };
        for (const fn of ["SLDLInitialize", "SLDLClose", "SLDLConsumeRight", "SLDLGetInformation"]) {
            this.exports[fn] = (_c, _mem, args) => { warn(fn, args); return S_OK; };
        }
    }

    reset(): void {}
}
