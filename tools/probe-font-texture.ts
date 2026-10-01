import { harness } from "./harness";

// Bundle already loaded. Dismiss the Run dialog, advance past the title, and
// settle in the menu panel where the labels live.
const r = await harness()
    .waitForEvent("dialogShow", { timeoutMs: 120_000 })
    .click("Run")
    .tickFrames(360, { timeoutMs: 150_000 })
    .keyHold(13, 450)
    .tickFrames(200, { timeoutMs: 150_000 })
    .run();

console.log(JSON.stringify(r, null, 2));