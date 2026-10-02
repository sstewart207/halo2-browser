import { harness } from "./harness";

const bundlePath = "C:/Users/sstew/Documents/Codex/2026-09-29/private-just-for-us-do-i/work/halo2-browser/bundles/halo2-2gb.wgb";

console.log("Loading Halo 2 bundle...");
const r = await harness()
    .reload()
    .call("logBufferSize", 20000)
    .call("streamLogs")
    .openWgb(bundlePath)
    .run();

console.log("Result:", JSON.stringify(r, null, 2));
