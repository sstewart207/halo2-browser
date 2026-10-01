import { harness } from "./harness";

// Load the font bundle only. Reload separately so the facade survives the eval.
const bundlePath =
    "C:/Users/sstew/Documents/Codex/2026-09-29/private-just-for-us-do-i/work/halo2-browser/bundles/halo2-2gb.wgb";

const r = await harness().openWgb(bundlePath).run();

console.log(JSON.stringify(r, null, 2));