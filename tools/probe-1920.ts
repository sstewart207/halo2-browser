import { CdpSession, findTab, GAME_DEV_FILTER, workerEval } from "./cdp-core";

async function main() {
    const target = await findTab(GAME_DEV_FILTER, { port: 9333 });
    const session = await CdpSession.connect(target.webSocketDebuggerUrl);
    try {
        const res = await workerEval(session, `(() => {
            const mem = globalThis.instance.process.getCurrentMemory();
            const view = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
            const p1920 = view.getUint32(0x008c1920, true);
            const fields = {};
            for (let i = 0; i < 0x60; i += 4) {
                fields['+' + i.toString(16)] = '0x' + view.getUint32(p1920 + i, true).toString(16) + ' (' + view.getInt32(p1920 + i, true) + ')';
            }
            return { p1920: '0x' + p1920.toString(16), fields };
        })()`);
        console.log(JSON.stringify(res, null, 2));
    } finally {
        session.close();
    }
}

main().catch(console.error);
