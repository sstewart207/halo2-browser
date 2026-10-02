# Halo 2 boot-to-campaign recipe (Chrome, dev build)

Verified Oct 1 2026 (Claude Sonnet 5.5). Gets from a cold page to the Cairo Station opening with about 10 browser calls, no screenshots needed between steps. The bundle stays private and outside Git.

## Prerequisites

- Vite dev server on `http://localhost:5174` (`bun --bun node_modules/vite/bin/vite.js` from `work/bottleship-research`; `bun`/`bunx` may not be on PATH, use the toolchain copy under `work/toolchain/node_modules/@oven/bun-windows-x64/bin/bun.exe`).
- The Chrome window must be **visible, focused and normal sized**. A hidden/minimized tab throttles rendering, skews every fps number and makes screenshots time out.
- Any edit under `src/` triggers a Vite hot reload that restarts the whole game. Expect to redo this recipe after code changes.
- Private bundle: `work/halo2-browser/bundles/halo2-2gb.wgb`.

## Steps (run as page JavaScript, e.g. through the Chrome extension)

1. Open `http://localhost:5174/?game=dev` and wait until the page title is `BottleShip`.
2. Load the bundle and press the guest's Run button. The harness can find guest controls, so no pixel coordinates are needed:

```js
const h = window.harness, wait = (ms) => new Promise(r => setTimeout(r, ms));
await h.openWgb("C:/Users/<you>/.../work/halo2-browser/bundles/halo2-2gb.wgb", { reload: false });
let row = null;
for (let i = 0; i < 8 && !row; i++) { await wait(2500); row = await h.rpc('findControl', ['Run']); }
await h.rpc('clickHold', [row.cx, row.cy, 250]);   // guest coordinates; was (483, 399)
await wait(40000);                                    // title screen is up about 40-50 s after Run
```

   The "Halo 2 for Windows Vista has one or more compatibility issues" dialog is the game's own startup check (no Windows Experience Index data in the emulated OS). It is not a crash; Run proceeds. See issue #10.

3. Keyboard navigation (`keyHold(vk, ms)`; a plain tap can be invisible to the guest). Enter = 13, Up = 38, Down = 40, Escape = 27:

| Press | Wait | Screen |
|---|---|---|
| Enter (500 ms) | 8 s | ONLINE ACCOUNTS |
| Enter | 10 s | Play Offline selected, back to title "Locally signed in" |
| Enter | 9 s | CAMPAIGN OPTIONS, "New Campaign" |
| Enter | 12 s | SELECT LEVEL (all missions listed) |
| Up (400 ms), then Enter | 4 s, then 14 s | CHOOSE DIFFICULTY (Easy/Normal/Heroic/Legendary) |
| Enter | 30 s | Campaign loads: Cairo Station tutorial ("Move the Mouse to look up") |

   Each page-JavaScript call is capped at about 45 s by the extension; split long waits across calls.

## Measuring

The dev panel has a collapsible **System stats** strip (GPU, FPS, guest RAM, VRAM estimate, browser JS heap). For a per-frame breakdown use `await h.rpc('perfProfile',[{enable:true,reset:true}])`, wait 12 s, then `await h.rpc('perfStats',[])` (categories v86 / thunk / gpu / present).

Observed (tab visible): title 10-15 fps, menus 19-35 fps, Cairo Station opening about 11 fps.

## Debugging traps (details in HANDOFF.md NEWEST-29)

- A "paused" breakpoint does not freeze the guest; use the hit snapshot or `breakOn(..., { capture: [...] })` instead of reading memory afterwards.
- Interior (mid-block) EIP breakpoints do not fire; function entries and call-return addresses do.
- Repeated pause/resume cycles can trigger the game's crash reporter ("Crash Report for Halo 2: Project Cartographer").
- Never post, comment or open PRs/issues on upstream repos (jenissimo/bottleship, v86, Cartographer) without asking the owner; pass `--repo sstewart207/halo2-browser` to every `gh` command.
