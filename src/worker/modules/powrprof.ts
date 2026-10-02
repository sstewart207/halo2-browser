import { IModule } from "../core/module";
import { Process } from "../core/process";
import { ThunkImplementation } from "../core/thunking/thunk-dispatcher";
import { EMULATED_CPU_MHZ, EMULATED_PROCESSOR_COUNT } from "../core/cpu/emulator-config";

const STATUS_SUCCESS = 0;
const STATUS_INVALID_PARAMETER = 0xc000000d;
const STATUS_BUFFER_TOO_SMALL = 0xc0000023;
const STATUS_NOT_SUPPORTED = 0xc00000bb;

const POWER_LEVEL_PROCESSOR_INFORMATION = 11;
const PROCESSOR_POWER_INFORMATION_SIZE = 24;

export class Powrprof implements IModule {
    name = "powrprof";
    exports: Record<string, ThunkImplementation> = {};

    initialize(_process: Process): void {
        // NTSTATUS CallNtPowerInformation(level, in, inLen, out, outLen)
        // ProcessorInformation fills one PROCESSOR_POWER_INFORMATION per logical processor:
        // { ULONG Number, MaxMhz, CurrentMhz, MhzLimit, MaxIdleState, CurrentIdleState }.
        this.exports["CallNtPowerInformation"] = (_ctx, mem, args) => {
            const level = args[0] >>> 0;
            const out = args[3] >>> 0;
            const outLen = args[4] >>> 0;
            const ret = (value: number) => ({ value: value >>> 0, stackCleanup: 20 });

            if (level !== POWER_LEVEL_PROCESSOR_INFORMATION) return ret(STATUS_NOT_SUPPORTED);
            const needed = EMULATED_PROCESSOR_COUNT * PROCESSOR_POWER_INFORMATION_SIZE;
            if (!out || out + needed > mem.length) return ret(STATUS_INVALID_PARAMETER);
            if (outLen < needed) return ret(STATUS_BUFFER_TOO_SMALL);

            const view = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
            for (let cpu = 0; cpu < EMULATED_PROCESSOR_COUNT; cpu++) {
                const base = out + cpu * PROCESSOR_POWER_INFORMATION_SIZE;
                view.setUint32(base + 0, cpu, true);
                view.setUint32(base + 4, EMULATED_CPU_MHZ, true);   // MaxMhz
                view.setUint32(base + 8, EMULATED_CPU_MHZ, true);   // CurrentMhz
                view.setUint32(base + 12, EMULATED_CPU_MHZ, true);  // MhzLimit
                view.setUint32(base + 16, 0, true);                 // MaxIdleState
                view.setUint32(base + 20, 0, true);                 // CurrentIdleState
            }
            return ret(STATUS_SUCCESS);
        };
    }

    reset(): void {}
}
