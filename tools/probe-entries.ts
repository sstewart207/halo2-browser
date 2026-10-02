import { CdpSession, findTab, GAME_DEV_FILTER, workerEval } from "./cdp-core";

async function main() {
    const target = await findTab(GAME_DEV_FILTER, { port: 9333 });
    const session = await CdpSession.connect(target.webSocketDebuggerUrl);
    try {
        const res = await workerEval(session, `(() => {
            const mem = globalThis.instance.process.getCurrentMemory();
            const view = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
            const p1920 = view.getUint32(0x008c1920, true);
            const dataPtr = view.getUint32(p1920 + 0x44, true);
            const count = view.getUint32(p1920 + 0x38, true); // 126
            const entries = [];
            let readyCount = 0;
            let notReadyCount = 0;
            for (let i = 0; i < count; i++) {
                const base = dataPtr + i * 12;
                const gen = view.getUint16(base, true);
                const ready = view.getUint8(base + 2);
                const glyphIdx = view.getUint32(base + 4, true);
                const task = view.getUint32(base + 8, true);
                if (gen !== 0) {
                    if (ready !== 0) readyCount++;
                    else notReadyCount++;
                    entries.push({ i, gen, ready, glyphIdx, task: '0x' + task.toString(16) });
                }
            }
            return { totalActive: entries.length, readyCount, notReadyCount, sample: entries.slice(0, 20) };
        })()`);
        console.log(JSON.stringify(res, null, 2));
    } finally {
        session.close();
    }
}

main().catch(console.error);
