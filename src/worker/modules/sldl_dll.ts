import { IModule } from "../core/module";
import { Process } from "../core/process";
import { ThunkImplementation } from "../core/thunking/thunk-dispatcher";

/**
 * sldl_dll.dll — HLE of the Windows software-licensing client DLL.
 *
 * Why HLE: the native SLDL_DLL.dll protects its own code with in-place
 * decrypted fragments (call + inline encrypted bytes, patched via
 * VirtualProtect), so it cannot be statically recompiled to WebAssembly.
 * Project Cartographer (modern Halo 2 Vista) needs no license entitlement.
 *
 * Behaviour: every call succeeds (HRESULT S_OK) and writes no outputs.
 * Only the seven exports halo2.exe imports are provided. This is a
 * deliberate substitution, not a licensing implementation.
 */
const S_OK = 0;

export class SldlDll implements IModule {
    name = "sldl_dll";
    exports: Record<string, ThunkImplementation> = {};

    initialize(_process: Process): void {
        const ok: ThunkImplementation = () => S_OK;
        for (const fn of [
            "SLDLInitialize", "SLDLOpen", "SLDLClose", "SLDLGetSLIDList",
            "SLDLConsumeRight", "SLDLGetLicensingStatusInformation", "SLDLGetInformation",
        ]) {
            this.exports[fn] = ok;
        }
    }

    reset(): void {}
}
