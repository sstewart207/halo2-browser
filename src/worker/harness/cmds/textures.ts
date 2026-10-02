/**
 * Texture / VRAM reading + frame capture.
 *
 * - textures(): a backend-agnostic gallery — DDraw/D3D7/D3D8 surfaces + D3D9
 *   TextureStore slots.
 * - dumpSurface(sel)/dumpTexture(sel): full-RGBA readback -> PNG (logs/debug/),
 *   preferring the authoritative rgbaScratch (zero GPU) for bitmap textures.
 * - expectSurfaceNonBlack(sel): cheap liveness assertion over a subsampled
 *   readback (reuses the existing dbgReadSurfacePixels nonBlackPct).
 * - captureFrame(): the RenderDoc-style per-draw capture. Works for the FFP
 *   backends (DDraw/D3D7, and D3D8 which loads the ddraw module's executor) via
 *   the existing frame-capture. D3D9 per-draw producers remain unimplemented.
 */

import type { HarnessService, HarnessCtx } from "../service";
import { HarnessError, HarnessErrorCode } from "../rpc";
import { getModule, serializeSurfaces } from "../serialize";
import { bytesToBase64 } from "./screen";
import { devices as d3d9Devices } from "../../modules/d3d9/shared-state";
import { startCapture as frameCaptureStart } from "../../modules/ddraw/frame-capture";
import { asArrayBufferView } from "../../../dom-buffer";

function ddraw(): any {
    return getModule("ddraw");
}

/** Resolve a surface selector to a pixel pointer (hex/number, or "primary"/"backbuffer"). */
function resolvePtr(sel: unknown): number {
    const dd = ddraw();
    if (sel === "primary") return (dd?.context?.surfaces?.primary ?? 0) >>> 0;
    if (sel === "backbuffer" || sel === "backBuffer") return (dd?.context?.surfaces?.backBuffer ?? 0) >>> 0;
    if (typeof sel === "number") return sel >>> 0;
    if (typeof sel === "string") return (sel.startsWith("0x") ? parseInt(sel.slice(2), 16) : parseInt(sel, 16)) >>> 0;
    throw new HarnessError(`bad surface selector ${JSON.stringify(sel)}`, HarnessErrorCode.BAD_ARGS);
}

export async function encodePngBase64(rgba: Uint8Array, w: number, h: number): Promise<string> {
    const cv = new OffscreenCanvas(w, h);
    const ctx = cv.getContext("2d");
    if (!ctx) throw new HarnessError("OffscreenCanvas 2d unavailable", HarnessErrorCode.UNSUPPORTED);
    ctx.putImageData(new ImageData(asArrayBufferView(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4)), w, h), 0, 0);
    const blob = await cv.convertToBlob({ type: "image/png" });
    return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

export function registerTextureCommands(svc: HarnessService): void {
    /** textures() — gallery across backends. */
    svc.register("textures", () => {
        const ddrawSurfaces = (serializeSurfaces() as any[]).map((s) => ({ ...s, backend: "ddraw" }));
        const d3d9: unknown[] = [];
        for (const [ptr, dev] of d3d9Devices) {
            const info = (dev as any).getTexturesDebugInfo?.() ?? [];
            for (const t of info) d3d9.push({ ...t, backend: "d3d9", device: ptr >>> 0 });
        }
        return { ddraw: ddrawSurfaces, d3d9 };
    });

    /** d3d9TexturePixels(ptr): read authoritative color render-target statistics. */
    svc.register('d3d9TexturePixels', async (args) => {
        const ptr = Number(args[0]);
        if (!Number.isInteger(ptr) || ptr < 0 || ptr > 0xffffffff) {
            throw new HarnessError('expected a texture pointer', HarnessErrorCode.BAD_ARGS);
        }
        for (const device of d3d9Devices.values()) {
            if (ptr === 0 || device.getTexturesDebugInfo().some(texture => texture.handle === ptr)) {
                return device.readTexturePixelStats(ptr, args[1] === true);
            }
        }
        throw new HarnessError('D3D9 texture not found', HarnessErrorCode.NOT_FOUND);
    });

    /**
     * d3d9TextureCpuData(handleOrIndex): inspect CPU backing store of a D3D9 texture.
     *
     * Accepts either the handle reported by `textures()`/`d3d9TexturePixels`, or the
     * raw store index that draw diagnostics report as `texture0` (those come from
     * stateTracker.getTexture, which stores the index, not the pointer).
     */
    svc.register('d3d9TextureCpuData', (args) => {
        const sel = Number(args[0]);
        if (!Number.isInteger(sel) || sel < 0) {
            throw new HarnessError('expected a texture handle or store index', HarnessErrorCode.BAD_ARGS);
        }
        for (const device of d3d9Devices.values()) {
            const store = (device as any).textures;
            let idx = store.getIndex(sel);
            let via = 'handle';
            if (idx === null && args[1] === true) {
                // Explicit index mode: stateTracker texture indices are not handles.
                idx = sel;
                via = 'index';
            }
            if (idx === null) continue;
            const data = store.getData(idx);
            const w = store.getWidth(idx);
            const h = store.getHeight(idx);
            const fmt = store.getFormat(idx);
            if (!data) return { idx, via, w, h, fmt, noData: true };
            let nonZero = 0;
            let nonZeroAlpha = 0;
            let max = 0;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i] || data[i + 1] || data[i + 2]) nonZero++;
                if (data[i + 3]) nonZeroAlpha++;
                if (data[i] > max) max = data[i];
                if (data[i + 1] > max) max = data[i + 1];
                if (data[i + 2] > max) max = data[i + 2];
            }
            const sample = Array.from(data.subarray(0, 32));
            return {
                idx, via, w, h, fmt, bytes: data.length, totalPixels: w * h,
                nonZero, nonZeroAlpha, maxChannel: max, sample,
            };
        }
        return null;
    });

    /** dumpSurface(sel, {save?}) — DDraw surface -> PNG. */
    const dump = async (args: unknown[]) => {
        const ptr = resolvePtr(args[0]);
        if (!ptr) throw new HarnessError("surface pointer is 0 (no such surface / not initialized)", HarnessErrorCode.NOT_FOUND);
        const dd = ddraw();
        if (!dd?.readSurfaceRGBA) throw new HarnessError("ddraw module not loaded (D3D9-only games not yet supported for surface dump)", HarnessErrorCode.UNSUPPORTED);
        const r = await dd.readSurfaceRGBA(ptr);
        if ("err" in r) throw new HarnessError(`readSurfaceRGBA: ${r.err}`, HarnessErrorCode.INTERNAL);
        const opts = (args[1] ?? {}) as { save?: string };
        const name = (opts.save ?? `surf_${ptr.toString(16)}_${r.w}x${r.h}`).replace(/\.png$/i, "");
        const base64 = await encodePngBase64(r.rgba, r.w, r.h);
        (self as unknown as Worker).postMessage({ type: "debug_png_dump", name, base64 });
        return { saved: `logs/debug/${name}.png`, ptr: "0x" + ptr.toString(16), w: r.w, h: r.h, source: r.source };
    };
    svc.register("dumpSurface", dump);
    svc.register("dumpTexture", dump);

    /** expectSurfaceNonBlack(sel?, minPct?) — assertion (throws if black). */
    svc.register("expectSurfaceNonBlack", async (args) => {
        const sel = args[0] ?? "primary";
        const minPct = typeof args[1] === "number" ? (args[1] as number) : 1;
        const ptr = resolvePtr(sel);
        const dd = ddraw();
        if (!dd?.dbgReadSurfacePixels) throw new HarnessError("ddraw module not loaded", HarnessErrorCode.UNSUPPORTED);
        const r = await dd.dbgReadSurfacePixels(ptr);
        if (r?.err) throw new HarnessError(`readback failed: ${r.err}`, HarnessErrorCode.INTERNAL);
        if (!(r.nonBlackPct >= minPct)) {
            throw new HarnessError(`surface ${typeof sel === "string" ? sel : "0x" + ptr.toString(16)} is black: nonBlackPct=${r.nonBlackPct}% < ${minPct}% (avg=${r.avg})`, HarnessErrorCode.NOT_FOUND);
        }
        return { ok: true, ptr: "0x" + ptr.toString(16), nonBlackPct: r.nonBlackPct, avg: r.avg, w: r.w, h: r.h };
    });

    /** surfacePixels(sel) — the existing luminance/grid stats (no PNG). */
    svc.register("surfacePixels", async (args) => {
        const ptr = resolvePtr(args[0] ?? "primary");
        const dd = ddraw();
        if (!dd?.dbgReadSurfacePixels) throw new HarnessError("ddraw module not loaded", HarnessErrorCode.UNSUPPORTED);
        return dd.dbgReadSurfacePixels(ptr);
    });

    /** captureFrame(opts) — arm the per-draw CaptureBus for the next frame. Backend-
     *  agnostic now: DDraw/D3D7 (full FFP), D3D8 (full FFP via the shared executor),
     *  D3D9 (backend-tagged minimal draws). Resolves at the next present (onFrameEnd). */
    svc.register("captureFrame", async (args, ctx: HarnessCtx) => {
        const opts = (args[0] ?? {}) as { timeoutMs?: number };
        const timeoutMs = opts.timeoutMs ?? 5000;
        const frame = await Promise.race([
            frameCaptureStart(),
            new Promise((_res, rej) => {
                const t = setTimeout(() => rej(new HarnessError(`no frame presented within ${timeoutMs}ms`, HarnessErrorCode.TIMEOUT)), timeoutMs);
                ctx.signal.addEventListener("abort", () => { clearTimeout(t); rej(ctx.signal.reason ?? new HarnessError("aborted", HarnessErrorCode.CANCELLED)); }, { once: true });
            }),
        ]);
        return frame;
    });
}
