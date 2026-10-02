import { IModule } from "../core/module";
import { Process } from "../core/process";
import { ThunkImplementation } from "../core/thunking/thunk-dispatcher";
import { System } from "../core/system";
import { LoadedPEModule } from "../core/module-registry";
import { encodeAnsi } from "./codepage-utils";

const ERROR_INVALID_HANDLE = 6;
const ERROR_INVALID_PARAMETER = 87;
const ERROR_INSUFFICIENT_BUFFER = 122;
const MODULEINFO_SIZE = 12;

/**
 * psapi module queries answered from the process module registry: the main executable first, then the
 * loaded DLLs in load order. Emulator-provided system DLLs (kernel32 etc.) have no PE image and are not
 * listed.
 */
export class Psapi implements IModule {
    name = "psapi";
    exports: Record<string, ThunkImplementation> = {};

    private listModules(): LoadedPEModule[] {
        const registry = System.getInstance().process?.moduleRegistry;
        if (!registry) return [];
        const all = registry.getAllModules();
        return [...all.filter((m) => m.isExecutable), ...all.filter((m) => !m.isExecutable)];
    }

    private findModule(hModule: number): LoadedPEModule | undefined {
        const registry = System.getInstance().process?.moduleRegistry;
        if (!registry) return undefined;
        const base = registry.resolvePeModuleBase(hModule >>> 0);
        return this.listModules().find((m) => m.baseAddress >>> 0 === base);
    }

    private setError(code: number): void {
        System.getInstance().scheduler.setLastError(code);
    }

    initialize(_process: Process): void {
        // BOOL EnumProcessModules[Ex](HANDLE hProcess, HMODULE* lphModule, DWORD cb, LPDWORD lpcbNeeded[, DWORD dwFilterFlag])
        const enumModules = (stackCleanup: number): ThunkImplementation => (_ctx, mem, args) => {
            const lphModule = args[1] >>> 0;
            const cb = args[2] >>> 0;
            const lpcbNeeded = args[3] >>> 0;
            if (!lpcbNeeded || lpcbNeeded + 4 > mem.length) {
                this.setError(ERROR_INVALID_PARAMETER);
                return { value: 0, stackCleanup };
            }
            const modules = this.listModules();
            const view = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
            const fit = lphModule ? Math.min(modules.length, cb >>> 2) : 0;
            for (let i = 0; i < fit; i++) {
                if (lphModule + i * 4 + 4 > mem.length) break;
                view.setUint32(lphModule + i * 4, modules[i]!.baseAddress >>> 0, true);
            }
            view.setUint32(lpcbNeeded, modules.length * 4, true);
            return { value: 1, stackCleanup };
        };
        this.exports["EnumProcessModules"] = enumModules(16);
        this.exports["EnumProcessModulesEx"] = enumModules(20);

        // BOOL GetModuleInformation(HANDLE hProcess, HMODULE hModule, LPMODULEINFO lpmodinfo, DWORD cb)
        // MODULEINFO = { LPVOID lpBaseOfDll; DWORD SizeOfImage; LPVOID EntryPoint; }
        this.exports["GetModuleInformation"] = (_ctx, mem, args) => {
            const lpmodinfo = args[2] >>> 0;
            const cb = args[3] >>> 0;
            const mod = this.findModule(args[1]);
            if (!mod) {
                this.setError(ERROR_INVALID_HANDLE);
                return { value: 0, stackCleanup: 16 };
            }
            if (!lpmodinfo || cb < MODULEINFO_SIZE || lpmodinfo + MODULEINFO_SIZE > mem.length) {
                this.setError(ERROR_INSUFFICIENT_BUFFER);
                return { value: 0, stackCleanup: 16 };
            }
            const view = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
            view.setUint32(lpmodinfo, mod.baseAddress >>> 0, true);
            view.setUint32(lpmodinfo + 4, mod.size >>> 0, true);
            view.setUint32(lpmodinfo + 8, mod.entryPoint ? (mod.baseAddress + mod.entryPoint) >>> 0 : 0, true);
            return { value: 1, stackCleanup: 16 };
        };

        // DWORD GetModuleFileNameEx[A|W](HANDLE hProcess, HMODULE hModule, LPTSTR lpFilename, DWORD nSize)
        this.exports["GetModuleFileNameExA"] = (_ctx, mem, args) => {
            const lpFilename = args[2] >>> 0;
            const nSize = args[3] >>> 0;
            const mod = this.findModule(args[1]);
            if (!mod) {
                this.setError(ERROR_INVALID_HANDLE);
                return { value: 0, stackCleanup: 16 };
            }
            if (!lpFilename || nSize === 0) return { value: 0, stackCleanup: 16 };
            const bytes = encodeAnsi(mod.path);
            const n = Math.min(bytes.length, nSize - 1);
            mem.set(bytes.subarray(0, n), lpFilename);
            mem[lpFilename + n] = 0;
            if (n < bytes.length) this.setError(ERROR_INSUFFICIENT_BUFFER);
            return { value: n, stackCleanup: 16 };
        };

        this.exports["GetModuleFileNameExW"] = (_ctx, mem, args) => {
            const lpFilename = args[2] >>> 0;
            const nSize = args[3] >>> 0;
            const mod = this.findModule(args[1]);
            if (!mod) {
                this.setError(ERROR_INVALID_HANDLE);
                return { value: 0, stackCleanup: 16 };
            }
            if (!lpFilename || nSize === 0) return { value: 0, stackCleanup: 16 };
            const view = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
            const n = Math.min(mod.path.length, nSize - 1);
            for (let i = 0; i < n; i++) view.setUint16(lpFilename + i * 2, mod.path.charCodeAt(i), true);
            view.setUint16(lpFilename + n * 2, 0, true);
            if (n < mod.path.length) this.setError(ERROR_INSUFFICIENT_BUFFER);
            return { value: n, stackCleanup: 16 };
        };
    }
}
