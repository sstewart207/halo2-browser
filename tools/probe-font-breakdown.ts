import { CdpSession, findTab, GAME_DEV_FILTER, workerEval } from "./cdp-core";

async function main() {
    const target = await findTab(GAME_DEV_FILTER, { port: 9333 });
    const session = await CdpSession.connect(target.webSocketDebuggerUrl);
    try {
        const res = await workerEval(session, `(() => {
            const mem = globalThis.instance.process.getCurrentMemory();
            const view = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
            const p1918 = view.getUint32(0x008c1918, true);
            if (!p1918) return { error: "no p1918" };
            const count = view.getUint32(p1918 + 0x34, true);
            const dataPtr = view.getUint32(p1918 + 0x44, true);
            const fontCounts = {};
            const sampleByFont = {};
            for (let i = 0; i < count; i++) {
                const base = dataPtr + i * 56;
                const font = view.getInt32(base + 4, true);
                const ch = view.getUint32(base + 8, true);
                const state = view.getInt32(base + 0x10, true);
                const cache = view.getInt32(base + 0x2c, true);
                const atlas = view.getInt32(base + 0x34, true);
                fontCounts[font] = fontCounts[font] || { total: 0, withAtlas: 0, withCache: 0, states: {} };
                fontCounts[font].total++;
                if (atlas !== -1) fontCounts[font].withAtlas++;
                if (cache !== -1) fontCounts[font].withCache++;
                fontCounts[font].states[state] = (fontCounts[font].states[state] || 0) + 1;
                const charStr = (ch >= 32 && ch < 127) ? String.fromCharCode(ch) : ("0x" + ch.toString(16));
                sampleByFont[font] = sampleByFont[font] || [];
                if (sampleByFont[font].length < 25) {
                    sampleByFont[font].push({ ch: charStr, state, cache, atlas });
                }
            }
            return { count, fontCounts, sampleByFont };
        })()`);
        console.log(JSON.stringify(res, null, 2));
    } finally {
        session.close();
    }
}

main().catch(console.error);
