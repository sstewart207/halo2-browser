import { CdpSession, findTab, GAME_DEV_FILTER, workerEval } from "./cdp-core";

async function main() {
    const target = await findTab(GAME_DEV_FILTER, { port: 9333 });
    const session = await CdpSession.connect(target.webSocketDebuggerUrl);
    try {
        const result = await workerEval(session, `(() => {
            try {
                const mem = globalThis.instance.process.getCurrentMemory();
                const view = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);

                const tableLoaded = view.getUint8(0x0087e7c0);

                // Font table
                const fontTable = [];
                for (let i = 0; i < 12; i++) {
                    fontTable.push(view.getInt32(0x0087d570 + i * 4, true));
                }

                // Fonts 0..7
                const fonts = [];
                for (let i = 0; i < 8; i++) {
                    const base = 0x0087d5a0 + i * 0x1d0;
                    const handle = view.getInt32(base + 0x1c4, true);
                    const loaded = view.getUint8(base + 0x1c8);
                    const opened = view.getUint8(base + 0x1c9);
                    const task = view.getInt32(base + 0x1cc, true);
                    const head = [];
                    for (let j = 0; j < 4; j++) head.push('0x' + view.getUint32(base + j * 4, true).toString(16));
                    fonts.push({ i, handle, loaded, opened, task, head: head.join(',') });
                }

                // DAT_008c1918 (character data)
                const p1918 = view.getUint32(0x008c1918, true);
                const glyphs = [];
                let total = 0;
                if (p1918) {
                    const count = view.getUint32(p1918 + 0x34, true);
                    const dataPtr = view.getUint32(p1918 + 0x44, true);
                    total = count;
                    for (let i = 0; i < count; i++) {
                        const base = dataPtr + i * 56;
                        const font = view.getInt32(base + 4, true);
                        const ch = view.getUint32(base + 8, true);
                        const state = view.getInt32(base + 0x10, true);
                        const cache = view.getInt32(base + 0x2c, true);
                        const atlas = view.getInt32(base + 0x34, true);
                        const charStr = (ch >= 32 && ch < 127) ? String.fromCharCode(ch) : ('0x' + ch.toString(16));
                        glyphs.push({ idx: i, font, ch: charStr, state, cache, atlas });
                    }
                }

                // Text drawer counter
                const drawCount = view.getUint32(0x0086873c, true);

                const p1920 = view.getUint32(0x008c1920, true);
                const p1924 = view.getUint32(0x008c1924, true);
                const pool1924 = [];
                if (p1924) {
                    for (let i = 0; i < 20; i++) pool1924.push('+' + (i*4).toString(16) + ': 0x' + view.getUint32(p1924 + i*4, true).toString(16));
                }
                const pool1920 = [];
                if (p1920) {
                    for (let i = 0; i < 16; i++) pool1920.push('+' + (i*4).toString(16) + ': 0x' + view.getUint32(p1920 + i*4, true).toString(16));
                }

                return {
                    tableLoaded,
                    fontTable,
                    p1920: '0x' + p1920.toString(16),
                    pool1920,
                    p1924: '0x' + p1924.toString(16),
                    pool1924,
                    totalGlyphs: total,
                    glyphsWithCacheCount: glyphs.filter(g => g.cache !== -1).length,
                    glyphsWithAtlasCount: glyphs.filter(g => g.atlas !== -1).length,
                };
            } catch (e) {
                return { error: String(e), stack: String(e.stack) };
            }
        })()`);

        console.log(JSON.stringify(result, null, 2));
    } finally {
        session.close();
    }
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
