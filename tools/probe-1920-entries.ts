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
            const count = view.getUint32(p1920 + 0x38, true); // max index watermark

            const entries = [];
            for (let i = 0; i < count; i++) {
                const base = dataPtr + i * 12;
                const b0 = view.getUint8(base);
                const b1 = view.getUint8(base + 1);
                const b2 = view.getUint8(base + 2);
                const b3 = view.getUint8(base + 3);
                const glyphHandle = view.getUint32(base + 4, true);
                const u8 = view.getUint32(base + 8, true);
                entries.push({
                    idx: i,
                    b0_1: (b1 << 8) | b0,
                    b2,
                    glyphHandle: '0x' + glyphHandle.toString(16),
                    u8: '0x' + u8.toString(16)
                });
            }
            return { count, sample: entries.slice(0, 20), b2Stats: entries.reduce((acc, e) => { acc[e.b2] = (acc[e.b2] || 0) + 1; return acc; }, {}) };
        })()`);
        console.log(JSON.stringify(res, null, 2));
    } finally {
        session.close();
    }
}

main().catch(console.error);
