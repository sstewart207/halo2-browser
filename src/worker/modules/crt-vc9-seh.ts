/**
 * VC9 _except_handler4_common — XOR-decoded scope table walk.
 */

import { Logger, LogCategory } from "../core/logger";
import { evaluateSimpleFilter } from "../core/seh-dispatch";
import type { ThunkImplementation, ThunkResult } from "../core/thunking/thunk-dispatcher";
import { SEH_SCRATCH_LAYOUT } from "../core/thunking/seh-layout";
import { getCPU } from "../core/thunking/thunk-utils";
import type { Process } from "../core/process";

export interface Vc9SehHost {
    process: Process;
    notifySehAborted: (reason: string) => void;
}

export function registerVc9SehExports(exports: Record<string, ThunkImplementation>, host: Vc9SehHost): void {
    // (CookiePointer, CookieCheckFunction, ExceptionRecord, EstablisherFrame, ContextRecord, DispatcherContext)
    exports["_except_handler4_common"] = (_ctx, mem, args): ThunkResult | number => {
        const cookiePtr = args[0] >>> 0;
        const pExcRec = args[2] >>> 0;
        const frameAddr = args[3] >>> 0;
        const pContext = args[4] >>> 0;

        const cpu = getCPU(host.process.v86);
        if (!cpu) return 1;

        const dv = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
        const excFlags = pExcRec + 4 < mem.length ? dv.getUint32(pExcRec + 4, true) : 0;
        if (excFlags & 0x06) return 1; // unwind — ContinueSearch

        if (frameAddr + 16 > mem.length || cookiePtr + 4 > mem.length) return 1;

        const cookie = dv.getUint32(cookiePtr, true);
        // Only the scope table pointer is encoded; the table entries themselves are plain.
        const scopeTable = (dv.getUint32(frameAddr + 8, true) ^ cookie) >>> 0;
        let trylevel = dv.getInt32(frameAddr + 12, true);
        const frameEbp = frameAddr + 16;

        if (scopeTable < 0x1000 || scopeTable + 28 > mem.length) {
            Logger.warn(LogCategory.SYSTEM,
                `_except_handler4_common: bad scopeTable=0x${scopeTable.toString(16)}`);
            return 1;
        }

        const entriesBase = scopeTable + 16;
        Logger.verbose(LogCategory.SYSTEM,
            `_except_handler4_common: frame=0x${frameAddr.toString(16)} scope=0x${scopeTable.toString(16)} ` +
            `trylevel=${trylevel}`);

        // EXCEPTION_POINTERS must not live in the guest frame: [ebp-0x18] holds the saved ESP that
        // the __except block reloads. Only [ebp-0x14] (= frame-4) points at it.
        const epAddr = (host.process.dispatcher.getSehScratchAddr() + SEH_SCRATCH_LAYOUT.EXCEPTION_POINTERS) >>> 0;
        if (epAddr >= 4 && epAddr + 8 <= mem.length && frameAddr >= 4) {
            dv.setUint32(epAddr, pExcRec, true);
            dv.setUint32(epAddr + 4, pContext, true);
            dv.setUint32((frameAddr - 4) >>> 0, epAddr, true);
        }
        cpu.reg32[5] = frameEbp | 0;

        let safety = 0;
        while (trylevel >= 0 && safety < 256) {
            safety++;
            const entryBase = entriesBase + trylevel * 12;
            if (entryBase + 12 > mem.length) break;

            const prevSigned = dv.getInt32(entryBase, true);
            const filterAddr = dv.getUint32(entryBase + 4, true);
            const handlerAddr = dv.getUint32(entryBase + 8, true);

            if (filterAddr === 0 || filterAddr + 6 > mem.length) {
                trylevel = prevSigned;
                continue;
            }

            const exceptionCode = pExcRec !== 0 && pExcRec + 4 <= mem.length
                ? dv.getUint32(pExcRec, true)
                : 0xc0000005;
            const filterResult = evaluateSimpleFilter(mem, filterAddr, mem.length, exceptionCode);

            if (filterResult === 1) {
                dv.setInt32(frameAddr + 12, prevSigned, true);
                cpu.reg32[5] = frameEbp | 0;
                const adjustedEsp = (frameAddr - 4) >>> 0;
                cpu.reg32[4] = adjustedEsp;
                dv.setUint32(adjustedEsp, handlerAddr, true);
                host.notifySehAborted("eh4_execute_handler");
                return { value: 0, skipStackCheck: true };
            }
            if (filterResult === 0) {
                trylevel = prevSigned;
                continue;
            }
            if (filterResult === -1) return 0;
            // Complex filter: run it in the guest via the shared filter stub. The EH4 frame has the
            // same trylevel/EBP/EXCEPTION_POINTERS layout the stub expects.
            const redirected = host.process.dispatcher.prepareEh3ComplexFilterRedirect(
                cpu, frameAddr, prevSigned, trylevel, filterAddr, handlerAddr);
            if (!redirected) {
                Logger.error(LogCategory.SYSTEM,
                    `_except_handler4_common: cannot run complex filter 0x${filterAddr.toString(16)}`);
                return 1;
            }
            return { value: 0, skipStackCheck: true };
        }
        return 1;
    };
}
