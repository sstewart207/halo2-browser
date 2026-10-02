import { connect } from "./cdp-core";

const { session } = await connect();

async function evalPage(expr: string) {
    const r = await session.send("Runtime.evaluate", {
        expression: expr,
        awaitPromise: true,
        returnByValue: true,
    });
    return r.result;
}

const heap = await evalPage("window.__BS__.harness.rpc('heapReport', [])");
console.log("Heap report:", JSON.stringify(heap, null, 2));

session.close();
