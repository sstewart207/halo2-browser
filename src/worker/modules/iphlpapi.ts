import { IModule } from "../core/module";
import { Process } from "../core/process";
import { ThunkImplementation } from "../core/thunking/thunk-dispatcher";
import { Mem } from "../core/memory/mem-accessor";

const ERROR_INVALID_PARAMETER = 87;
const ERROR_INSUFFICIENT_BUFFER = 122;
const ERROR_NO_DATA = 232;
const ERROR_NOT_SUPPORTED = 50;

function readDword(mem: Uint8Array | null, ptr: number): number | null {
    if (!ptr) return null;
    if (!mem) return Mem.readUint32(ptr);
    if (ptr < 0 || ptr + 4 > mem.byteLength) return null;
    return new DataView(mem.buffer, mem.byteOffset, mem.byteLength).getUint32(ptr, true);
}

function writeDword(mem: Uint8Array | null, ptr: number, value: number): boolean {
    if (!ptr) return false;
    if (!mem) return Mem.writeUint32(ptr, value);
    if (ptr < 0 || ptr + 4 > mem.byteLength) return false;
    new DataView(mem.buffer, mem.byteOffset, mem.byteLength).setUint32(ptr, value, true);
    return true;
}

export class Iphlpapi implements IModule {
    name = "iphlpapi";
    exports: Record<string, ThunkImplementation> = {};

    initialize(_process: Process): void {
        // DWORD GetAdaptersInfo(PIP_ADAPTER_INFO pAdapterInfo, PULONG pOutBufLen)
        // Return ERROR_NO_DATA (232) — no network adapters available
        this.exports["GetAdaptersInfo"] = (_ctx, _mem, _args) => {
            return { value: 232, stackCleanup: 8 };
        };

        // The browser runtime exposes no native IPv4 stack or host adapters.
        // Report that state with Win32 error codes instead of returning fake data.
        // https://learn.microsoft.com/windows/win32/api/iphlpapi/nf-iphlpapi-getbestinterface
        this.exports["GetBestInterface"] = (_ctx, mem, args) => ({
            value: readDword(mem, args[1] >>> 0) === null
                ? ERROR_INVALID_PARAMETER : ERROR_NOT_SUPPORTED,
            stackCleanup: 8,
        });

        // An empty MIB_IPADDRTABLE contains only its DWORD entry count. Honor
        // the usual size-probe/retry contract even when there are no adapters.
        this.exports["GetIpAddrTable"] = (_ctx, mem, args) => {
            const tablePtr = args[0] >>> 0;
            const sizePtr = args[1] >>> 0;
            const capacity = readDword(mem, sizePtr);
            if (capacity === null || !writeDword(mem, sizePtr, 4)) {
                return { value: ERROR_INVALID_PARAMETER, stackCleanup: 12 };
            }
            if (!tablePtr || capacity < 4) {
                return { value: ERROR_INSUFFICIENT_BUFFER, stackCleanup: 12 };
            }
            return {
                value: writeDword(mem, tablePtr, 0) ? 0 : ERROR_INVALID_PARAMETER,
                stackCleanup: 12,
            };
        };

        this.exports["GetAdaptersAddresses"] = (_ctx, mem, args) => {
            const family = args[0] >>> 0;
            const valid = [0, 2, 23].includes(family)
                && (args[2] >>> 0) === 0
                && readDword(mem, args[4] >>> 0) !== null;
            return {
                value: valid ? ERROR_NO_DATA : ERROR_INVALID_PARAMETER,
                stackCleanup: 20,
            };
        };
    }
}
