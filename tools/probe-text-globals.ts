import { CdpSession, findTab, GAME_DEV_FILTER, workerEval } from "./cdp-core";

async function main() {
    const target = await findTab(GAME_DEV_FILTER, { port: 9333 });
    const session = await CdpSession.connect(target.webSocketDebuggerUrl);
    try {
        const res = await workerEval(session, `(() => {
            const mem = globalThis.instance.process.getCurrentMemory();
            const view = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
            return {
                DAT_008818ec: view.getUint8(0x008818ec),
                DAT_0086818e: view.getUint8(0x0086818e),
                DAT_00e3df72: view.getUint8(0x00e3df72),
                DAT_0086873c_drawCount: view.getUint32(0x0086873c, true),
                DAT_00e4bdd0: view.getUint8(0x00e4bdd0),
                DAT_00e4bddc: "0x" + view.getUint32(0x00e4bddc, true).toString(16),
                DAT_00e3e424_float: view.getFloat32(0x00e3e424, true),
                DAT_00e3e424_hex: "0x" + view.getUint32(0x00e3e424, true).toString(16),
                clip_8e66f8: [view.getInt16(0x008e66f8, true), view.getInt16(0x008e66fa, true), view.getInt16(0x008e66fc, true), view.getInt16(0x008e66fe, true)],
                clip_8e6700: [view.getInt16(0x008e6700, true), view.getInt16(0x008e6702, true), view.getInt16(0x008e6704, true), view.getInt16(0x008e6706, true)],
            };
        })()`);
        console.log(JSON.stringify(res, null, 2));
    } finally {
        session.close();
    }
}

main().catch(console.error);
