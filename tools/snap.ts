import { CdpSession, findTab, GAME_DEV_FILTER } from "./cdp-core";

async function main() {
    const target = await findTab(GAME_DEV_FILTER, { port: 9333 });
    const session = await CdpSession.connect(target.webSocketDebuggerUrl);
    try {
        const sendWithTimeout = (method: string, params: any = {}, timeoutMs = 15000) => {
            return Promise.race([
                session.send(method, params),
                new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout ${method}`)), timeoutMs)),
            ]);
        };

        await sendWithTimeout("Page.bringToFront").catch(() => {});
        await sendWithTimeout("Page.enable").catch(() => {});
        const r: any = await sendWithTimeout("Page.captureScreenshot", { format: "png" });
        if (r?.result?.data) {
            const outPath = process.argv[2] || "logs/live-screen.png";
            const fs = await import("fs");
            fs.writeFileSync(outPath, Buffer.from(r.result.data, "base64"));
            console.log(`Saved screenshot to ${outPath} (${r.result.data.length} b64 chars)`);
        } else {
            console.error("No screenshot data received");
        }
    } finally {
        session.close();
    }
}

main().catch(err => {
    console.error("Error in snap:", err);
    process.exit(1);
});
