# Halo 2 boot-to-campaign recipe (Chrome, dev build)

Verified Oct 1 2026 (Claude Sonnet 5.5), CORRECTED Oct 2 2026 (Codex). Gets from a cold page to the playable level with about 12 browser calls. The bundle stays private and outside Git.

> **Two corrections (Oct 2).** (1) The harness global is `window.__BS__.harness`, not `window.harness`. (2) **Choose "Armory" (the 2nd entry), not Cairo Station.** The bundle contains only `01a_tutorial.map`; every other mission's scenario file is missing and the game retries it forever at 60 fps (see next-agent-handoff.md, section 1).

## Fast Automated Runner (Added Oct 2, NEWEST-32)

Instead of sending 12 manual browser calls, run the automated TypeScript scripts from `work/bottleship-research`:

```bash
# 1. Boot bundle and arm logging:
bun tools/boot-halo2.ts

# 2. Advance through menus to Armory campaign level:
bun tools/step-nav.ts

# 3. Test in-level mouse-look (DirectInput camera rotation):
bun tools/test-look.ts

# 4. Measure live FPS, categories (v86/thunk/gpu/present), and guest RAM:
bun tools/measure-perf.ts
```

## Prerequisites

- Vite dev server on `http://localhost:5174` (`bun --bun node_modules/vite/bin/vite.js` from `work/bottleship-research`; `bun`/`bunx` may not be on PATH, use the toolchain copy under `work/toolchain/node_modules/@oven/bun-windows-x64/bin/bun.exe`).
- The Chrome window must be **visible, focused and normal sized**. A hidden/minimized tab throttles rendering, skews every fps number and makes screenshots time out.
- Any edit under `src/` triggers a Vite hot reload that restarts the whole game. Expect to redo this recipe after code changes.
- Private bundle: `work/halo2-browser/bundles/halo2-2gb.wgb`.

## Steps (run as page JavaScript, e.g. through the Chrome extension)

1. Open `http://localhost:5174/?game=dev` and wait until the page title is `BottleShip`.
2. Load the bundle and press the guest's Run button. The harness can find guest controls, so no pixel coordinates are needed:

```js
const h = window.__BS__.harness, wait = (ms) => new Promise(r => setTimeout(r, ms));
await h.openWgb("C:/Users/<you>/.../work/halo2-browser/bundles/halo2-2gb.wgb", { reload: false });
let row = null;
for (let i = 0; i < 8 && !row; i++) { await wait(2500); row = await h.rpc('findControl', ['Run']); }
await h.rpc('clickHold', [row.cx, row.cy, 250]);   // guest coordinates; was (483, 399)
await wait(40000);                                    // title screen is up about 40-50 s after Run
```

   The "Halo 2 for Windows Vista has one or more compatibility issues" dialog is the game's own startup check (no Windows Experience Index data in the emulated OS). It is not a crash; Run proceeds. See issue #10.

3. Keyboard navigation. `keyHold(vk, ms)`; a plain tap can be invisible to the guest. Enter = 13, Up = 38, Down = 40, Escape = 27.

   **Hold lengths matter:** menu lists AUTO-REPEAT while a key is held (a 600 ms Down moves the selection 3 rows), so use a ~130 ms tap to move exactly one row. Escape needs a ~900 ms hold to leave a panel; 500 ms is ignored.

| Press | Wait | Screen |
|---|---|---|
| Enter (500 ms) | 8 s | ONLINE ACCOUNTS |
| Enter (500 ms) | 10 s | Play Offline selected, back to title "Locally signed in" |
| Enter (500 ms) | 8 s | CHOOSE PLAYER (a saved profile appears here; first run opens the PROFILE NAME virtual keyboard - Enter accepts the default) |
| Enter (500 ms) | 6 s | "ARE YOU SURE? You're not signed in to Live" - Enter accepts OK |
| Enter (500 ms) | 9 s | main menu (CAMPAIGN highlighted) then CAMPAIGN OPTIONS, "New Campaign" |
| Enter (500 ms) | 12 s | SELECT LEVEL, all missions listed |
| Down (130 ms) | 3 s | **Armory** selected (2nd entry) - verify the mission card on the right before continuing |
| Enter (150 ms) | 6 s | CHOOSE DIFFICULTY |
| Enter (150 ms) | 20-40 s | Level loads: black room, red glow, "Move the Mouse to look up", HUD |

   Escape (900 ms) at any point backs out one panel; during a level load it aborts the load.

   Each page-JavaScript call is capped at about 10 s in the current tooling (the extension allowed ~45 s), so run the sequence as a background async function in the page and poll a log object rather than awaiting long waits inline.

## Measuring

The dev panel has a collapsible **System stats** strip (GPU, FPS, guest RAM, VRAM estimate, browser JS heap). For a per-frame breakdown use `await h.rpc('perfProfile',[{enable:true,reset:true}])`, wait 12 s, then `await h.rpc('perfStats',[])` (categories v86 / thunk / gpu / present).

Observed (tab visible): loading/menu wipe 60 fps, title 10-15 fps, menus 19-35 fps, in-level about 18.5 fps (v86 38.7 ms, thunk 14.4 ms).

To tell "still loading" from "hung on a missing map", sample the heap twice a few seconds apart: a real load moves HEAP_HI, a missing-map spin leaves every bucket byte-identical while still drawing at 60 fps. `h.rpc('logs', [400])` then look for repeated `GetFileAttributesA("maps\\...")` of a file that `h.rpc('fsList', ['C:\\maps'])` does not list.

## Debugging traps (details in HANDOFF.md NEWEST-29)

- A "paused" breakpoint does not freeze the guest; use the hit snapshot or `breakOn(..., { capture: [...] })` instead of reading memory afterwards.
- Interior (mid-block) EIP breakpoints do not fire; function entries and call-return addresses do.
- Repeated pause/resume cycles can trigger the game's crash reporter ("Crash Report for Halo 2: Project Cartographer").
- Never post, comment or open PRs/issues on upstream repos (jenissimo/bottleship, v86, Cartographer) without asking the owner; pass `--repo sstewart207/halo2-browser` to every `gh` command.
