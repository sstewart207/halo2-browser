import { connect, screenshot } from "./cdp-core";
import { writeFileSync } from "fs";

const { session } = await connect();

async function snap(name: string) {
    const base64 = await screenshot(session);
    writeFileSync(`logs/${name}.png`, Buffer.from(base64, "base64"));
    console.log(`Saved logs/${name}.png`);
}

async function evalPage(expr: string) {
    const r = await session.send("Runtime.evaluate", {
        expression: expr,
        awaitPromise: true,
        returnByValue: true,
    });
    return r.result?.value;
}

async function pressKey(vk: number, holdMs: number, waitMs: number, snapName: string) {
    console.log(`Pressing key ${vk} (${holdMs}ms), then waiting ${waitMs}ms...`);
    await evalPage(`window.__BS__.harness.rpc('keyHold', [${vk}, ${holdMs}])`);
    await Bun.sleep(waitMs);
    await snap(snapName);
}

// 1. Enter (150ms) -> Choose Difficulty
await pressKey(13, 150, 6000, "halo2-step8-difficulty");

// 2. Enter (150ms) -> Start Mission Loading
await pressKey(13, 150, 25000, "halo2-step9-loading");

// 3. Wait another 15s for level to be fully loaded and running
console.log("Waiting another 15s for level render...");
await Bun.sleep(15000);
await snap("halo2-step10-inlevel");

session.close();
