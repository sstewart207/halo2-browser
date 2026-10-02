import { CdpSession, findTab, GAME_DEV_FILTER, workerEval } from "./cdp-core";

async function main() {
    const target = await findTab(GAME_DEV_FILTER, { port: 9333 });
    const session = await CdpSession.connect(target.webSocketDebuggerUrl);
    try {
        const res = await workerEval(session, `(() => {
            const mem = globalThis.instance.process.getCurrentMemory();
            const view = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
            const p1924 = view.getUint32(0x008c1924, true);
            const p1920 = view.getUint32(0x008c1920, true);
            const p1918 = view.getUint32(0x008c1918, true);

            // In DAT_008c1924:
            // +0x2c: strategy?
            // +0x30: total blocks (0x1000 = 4096)
            // +0x34: shift (5)
            // +0x38: total bytes (0x206c8?)
            // +0x3c: head of allocated list?
            // +0x40: head of free list?
            const fields1924 = {};
            for (let o = 0; o < 0x80; o += 4) {
                fields1924['+' + o.toString(16)] = '0x' + view.getUint32(p1924 + o, true).toString(16);
            }

            // In DAT_008c1920 (data cache handle array):
            // count, capacity, dataPtr
            const count1920 = view.getUint32(p1920 + 0x34, true);
            const max1920 = view.getUint32(p1920 + 0x38, true);
            const ptr1920 = view.getUint32(p1920 + 0x44, true);

            // In DAT_008c1918 (glyphs):
            const count1918 = view.getUint32(p1918 + 0x34, true);
            const data1918 = view.getUint32(p1918 + 0x44, true);
            let noCacheCount = 0;
            const noCacheChars = [];
            for (let i = 0; i < count1918; i++) {
                const base = data1918 + i * 56;
                const font = view.getInt32(base + 4, true);
                const ch = view.getUint32(base + 8, true);
                const cache = view.getInt32(base + 0x2c, true);
                const byteSize = view.getUint16(base + 0x1e, true);
                if (cache === -1) {
                    noCacheCount++;
                    const charStr = (ch >= 32 && ch < 127) ? String.fromCharCode(ch) : ("0x" + ch.toString(16));
                    noCacheChars.push({ font, ch: charStr, byteSize });
                }
            }

            return {
                fields1924,
                pool1920: { count: count1920, max: max1920 },
                glyphs: { total: count1918, noCacheCount, noCacheChars }
            };
        })()`);
        console.log(JSON.stringify(res, null, 2));
    } finally {
        session.close();
    }
}

main().catch(console.error);
