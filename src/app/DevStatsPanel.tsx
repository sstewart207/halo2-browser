import React, { useEffect, useState } from "react";
import { getWebGPUAdapterInfo } from "../browser-support";
import s from "./DevStatsPanel.module.css";

type DevStats = {
  fps: number;
  frames: number;
  drawCalls: number;
  guestRamTotalBytes: number;
  guestRamLiveBytes: number;
  gpuTextureBytes: number;
  gpuTextureCount: number;
  emulatedVramBytes: number;
};

const STORAGE_KEY = "bottleship.devStatsPanel.open";
const POLL_MS = 1000;

function readStoredOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function storeOpen(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
  } catch {
    /* storage can be blocked; the panel still works */
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(0)} MB`;
}

/** Chrome-only; absent elsewhere. */
function browserJsHeapBytes(): number | null {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? mem.usedJSHeapSize : null;
}

function describeGpu(info: Awaited<ReturnType<typeof getWebGPUAdapterInfo>>): string {
  if (!info) return "Unavailable";
  const parts = [info.vendor, info.architecture, info.device, info.description].filter(Boolean);
  return parts.length ? parts.join(" / ") : "Adapter reports no details";
}

function Row({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className={s["row"]} title={title}>
      <span className={s["label"]}>{label}</span>
      <span className={s["value"]}>{value}</span>
    </div>
  );
}

export default function DevStatsPanel({ worker }: { worker: Worker | null }) {
  const [open, setOpen] = useState(readStoredOpen);
  const [stats, setStats] = useState<DevStats | null>(null);
  const [gpu, setGpu] = useState<string>("Detecting...");
  const [jsHeap, setJsHeap] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getWebGPUAdapterInfo().then((info) => {
      if (!cancelled) setGpu(describeGpu(info));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open || !worker) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "dev_stats" && event.data.ok) {
        setStats(event.data.stats as DevStats);
        setJsHeap(browserJsHeapBytes());
      }
    };
    worker.addEventListener("message", onMessage);
    worker.postMessage({ type: "dev_stats" });
    const timer = setInterval(() => worker.postMessage({ type: "dev_stats" }), POLL_MS);
    return () => {
      worker.removeEventListener("message", onMessage);
      clearInterval(timer);
    };
  }, [open, worker]);

  const toggle = () => {
    setOpen((prev) => {
      storeOpen(!prev);
      return !prev;
    });
  };

  return (
    <div className={s["panel"]}>
      <button
        type="button"
        className={s["header"]}
        onClick={toggle}
        aria-expanded={open}
        aria-controls="dev-stats-body"
      >
        <span className={s["chevron"]} aria-hidden="true">{open ? "▾" : "▸"}</span>
        System stats
        {!open && stats ? <span className={s["summary"]}>{Math.round(stats.fps)} fps</span> : null}
      </button>
      {open && (
        <div id="dev-stats-body" className={s["body"]}>
          <Row label="GPU" value={gpu} title="Adapter reported by the browser's WebGPU implementation" />
          <Row
            label="FPS"
            value={stats ? `${Math.round(stats.fps)} (frame ${stats.frames}, ${stats.drawCalls} draws)` : "waiting for game"}
            title="Frames presented by the guest's D3D device per second"
          />
          <Row
            label="Guest RAM"
            value={stats ? `${formatBytes(stats.guestRamLiveBytes)} live of ${formatBytes(stats.guestRamTotalBytes)}` : "waiting for game"}
            title="Live heap allocations inside the emulated machine versus its configured RAM"
          />
          <Row
            label="Browser JS heap"
            value={jsHeap === null ? "not reported by this browser" : formatBytes(jsHeap)}
            title="Main-thread JavaScript heap (Chrome only)"
          />
          <Row
            label="VRAM (textures)"
            value={
              stats
                ? `${formatBytes(stats.gpuTextureBytes)} in ${stats.gpuTextureCount} textures (estimated)`
                : "waiting for game"
            }
            title="Estimated GPU memory held by the emulator's textures. WebGPU does not expose real VRAM usage; buffers and render targets are not counted."
          />
          <Row
            label="VRAM (emulated)"
            value={stats ? `${formatBytes(stats.emulatedVramBytes)} reported to the guest` : "waiting for game"}
            title="Video memory size the emulator tells the game it has"
          />
        </div>
      )}
    </div>
  );
}
