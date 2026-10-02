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

console.log("Looking down with moveRel to target bottom light...");
for (let i = 0; i < 15; i++) {
    await evalPage("window.__BS__.harness.rpc('moveRel', [0, 50])");
    await Bun.sleep(100);
}

await Bun.sleep(2000);
await snap("halo2-step13-looked-down");

session.close();
