import { CdpSession, findTab, GAME_DEV_FILTER, workerEval } from "./cdp-core";

async function main() {
    const target = await findTab(GAME_DEV_FILTER, { port: 9333 });
    const session = await CdpSession.connect(target.webSocketDebuggerUrl);
    try {
        const res = await workerEval(session, `(() => {
            const mem = globalThis.instance.process.getCurrentMemory();
            const view = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
            const p1918 = view.getUint32(0x008c1918, true);
            const dataPtr = view.getUint32(p1918 + 0x44, true);
            const count = view.getUint32(p1918 + 0x34, true);

            const charsToFind = "PRESS ANY KEY".split('');
            const found = [];

            for (let i = 0; i < count; i++) {
                const base = dataPtr + i * 56;
                const font = view.getInt32(base + 4, true);
                const ch = view.getUint32(base + 8, true);
                const charStr = String.fromCharCode(ch);
                if (font === 2 && charsToFind.includes(charStr)) {
                    const fields = {};
                    for (let o = 0; o < 56; o += 4) {
                        fields['+' + o.toString(16)] = '0x' + view.getUint32(base + o, true).toString(16) + ' (' + view.getInt32(base + o, true) + ')';
                    }
                    found.push({ glyphIdx: i, font, ch: charStr, fields });
                }
            }
            return found;
        })()`);
        console.log(JSON.stringify(res, null, 2));
    } finally {
        session.close();
    }
}

main().catch(console.error);
