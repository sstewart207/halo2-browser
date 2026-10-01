import { harness } from "./harness";

// Drive phase only: the bundle is already loaded. Dismiss the Run dialog,
// advance past the title, then settle in the menu panel where labels live.
const r = await harness()
    .call("dialogs", [])
    .waitForEvent("dialogShow", { timeoutMs: 120_000 })
    .click("Run")
    .tickFrames(360, { timeoutMs: 150_000 })
    .keyHold(13, 450)
    .tickFrames(180, { timeoutMs: 150_000 })
    .run();

console.log(JSON.stringify(r, null, 2));