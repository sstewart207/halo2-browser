# Prompt for Antigravity / Gemini (Gemini 3 Pro) taking over Halo 2 in the browser

Paste everything below the line as the first message of a new session, with the repo checked out at `work/bottleship-research` on branch `codex/halo2-browser-checkpoint` (HEAD `313ee41`). Budget-conscious: few tool calls, short answers, prove each step with a number, a screenshot or a passing test.

---
You are taking over a private hobby project: the real Windows game **Halo 2 (Project Cartographer, v0.7.4.2)** running locally in desktop Chrome, via the x86 emulator **v86** plus a fake-Windows layer (**BottleShip**) and a D3D9-to-WebGPU renderer. The user is a first-time big-project builder with a small budget, so be economical.

**Goal order:** (1) a first PLAYABLE build on desktop Chrome, (2) 60 fps, (3) DualSense/gamepad. Phones later. Never stream or run the game remotely.

**Read first, in this order:** `AGENTS.md` (workspace root, one level above the repo), then the **top section of `docs/next-agent-handoff.md`** (written Oct 2, this is the current state), then `HANDOFF.md` NEWEST-30 in the workspace root, then `docs/halo2-boot-recipe.md`. Skim `docs/halo2-decomp-research.md` only if asked about speed strategy.

---

## 1. Current state (all verified Oct 1-2 2026 in Chrome)

Menus are fully working and fully readable: title -> ONLINE ACCOUNTS -> Play Offline -> CHOOSE PLAYER -> main menu (CAMPAIGN/ONLINE/SPLIT SCREEN/NETWORK/SETTINGS/QUIT) -> CAMPAIGN OPTIONS -> SELECT LEVEL (all 15 missions with artwork) -> CHOOSE DIFFICULTY. The **main menu had never been reached before this session**; it is now.

**NOT working / NOT verified:**
- The world renders **black** in-level (this is the #1 blocker, section 3).
- Most campaign missions **never load** (section 2).
- In-level W/A/S/D movement, campaign saves, audio correctness, controller input: unverified.

## 2. Only ONE campaign mission loads; the others hang forever (bundle gap, not a game gap)

`fsList('C:\\maps')` in the guest returns exactly:

| file | bytes |
|---|---|
| `mainmenu.map` | 61,063,680 |
| `shared.map` | 201,512,960 |
| `single_player_shared.map` | 289,477,120 |
| `01a_tutorial.map` | 62,932,480 |
| `fonts/` | dir |

Selecting any mission whose scenario file is absent puts the game into an **infinite retry**: `h.rpc('logs', [400])` shows `GetFileAttributesA("maps\\<scenario>.map")` for the missing file repeating forever, interleaved with re-probes of the three maps that exist. Measured while it spins:

- 60 fps on the loading wipe (`perfStats`: v86 ~12 ms, thunk ~4 ms), EIP moving, no exception;
- guest heap **byte-identical across samples** (`heapReport`: HEAP 507.47 MB, HEAP_HI 309.19 MB);
- `Escape` (900 ms hold) aborts the load and returns to CHOOSE DIFFICULTY.

This looks exactly like the "wedge" in the old notes and **is not one** - no allocation, no exhaustion. Retires the "raise the arena" line of thinking for that symptom.

Scenario name per menu entry, read from the guest log:

| level-list entry | scenario probed | present? |
|---|---|---|
| The Heretic (1st) | `00a_introduction.map` | NO - hangs |
| **Armory (2nd)** | loads OK | yes (`01a_tutorial.map`) |
| Cairo Station (3rd) | `01b_spacestation.map` | NO - hangs |
| the other 12 | untested, almost certainly missing | NO |

**The game is not missing anything - the BUNDLE is.** The full Project Cartographer install at `C:/Games/Halo 2 Project Cartographer` should have every scenario; the assembled `work/halo2-browser/bundles/halo2-2gb.wgb` (740 MB) only carries one. The likely fix is **bundle assembly**: copy the missing `maps/*.map` (and any other assets the maps need) from the real install into the wgb, then re-verify with `fsList('C:\\maps')` and the `GetFileAttributesA` check above. NOTE the maps are big (each 60-300 MB, `shared.map` alone is 201 MB and `single_player_shared.map` 289 MB), so size/budget matters. **Until this is fixed the campaign cannot be played past the Armory.**

Diagnostic to keep: frozen heap + healthy fps + a repeating `GetFileAttributesA` in the log = missing asset, not memory exhaustion.

## 3. THE BLOCKER: the level renders black

With the Armory loaded you get a **black frame with one red light glow / lens flare**, the HUD (shield bar, motion-tracker radar, crosshair) and the tutorial prompt "Move the Mouse to look up". No geometry, no textures. The user independently confirms this. The renderer is alive: ~25,177 `Present` calls, real `ReadFile` traffic during load, 18.5 fps steady. So this is a shading/visibility/state problem, not a stall.

Strong lead to start from: **menus are pixel-correct** (fonts, mission artwork, emblems all render), so texture upload, the UI shader path and the rasterizer work. What differs in-level is world geometry with per-vertex lighting, fog, and the level's own pixel shaders (compiled from the map's tag data via d3dcompiler_43, which was fixed earlier - see NEWEST-29). Suggested probes, cheapest first:

1. `h.rpc('frameLog', [n])` and `h.rpc('rtDebug', [])` in-level: are world draw passes being submitted at all, and how do they differ from a menu pass? (The menu art renders, so compare against that.)
2. Count and inspect the D3D9 calls: `h.rpc('profilerStats', [])` gives per-API `count`/`totalMs` rows (e.g. `d3d9:IDirect3DDevice9Ex_Present`). Look at `DrawPrimitive`/`DrawIndexedPrimitive`, `SetPixelShader`/`SetVertexShader`, `SetTexture`, `SetRenderTarget`, `Stream`/`UpdateTexture`, `SetLight*`/`LightEnable`.
3. Check the render states that would black out lit geometry but not UI: `RS_FOGENABLE`/`FOGSTART`/`FOGEND`/`FOGCOLOR`, `RS_ZENABLE`/`ZWRITEENABLE`, `RS_ALPHABLENDENABLE`, `RS_LIGHTING`, `RS_COLORWRITEENABLE`, texture-stage states.
4. Check for shader failures in the log: grep case-insensitively for `shader`, `CreatePixelShader`, `CreateVertexShader`, `D3DX`, `compile`, `HRESULT` failures.
5. Consider that the camera may simply be **inside geometry** at the intro (the black + single light is consistent with that) - use the mouse-look from section 4 to look around and check whether anything ever appears. The tutorial prompt clearing after a real mouse move proves the camera DOES move.

Do not claim "the level renders" from a screenshot of the intro frame; the previous session did and it was wrong.

## 4. Input: measured, and one precise harness bug found

- **Menus: keyboard works.** Menu lists **auto-repeat while a key is held** (one 600 ms `Down` moved the selection 3 rows) - use ~130 ms taps to move exactly one row. **Escape needs a ~900 ms hold** to leave a panel; 500 ms is ignored on CHOOSE DIFFICULTY.
- **In-level Escape works**: GAME PAUSED appears with the level's own objective text ("Follow the Gunnery Sergeant's instructions"), which also proves the level data really loaded.
- **In-level mouse-look WORKS for a real player.** Dispatching `new PointerEvent('pointermove', {movementX: 70, ...})` at the canvas turns the camera, clears the "Move the Mouse to look up" tutorial and reveals new geometry (verified by before/after screenshots).
- **The harness `move`/`drag` verbs cannot drive mouse-look, and the mechanism is exact.** The game polls `IDirectInputDevice8A_GetDeviceState`, **not** `GetDeviceData` (`apiCensus` shows `GetDeviceState` called and `drainDInputMouseEvents` never). In `src/worker/modules/dinput/dinput.ts` (~line 880) that branch computes `dx/dy = accum - lastSeen`, where `accum = inputManager.getDInputAccum()` = SAB slots `dinputDX`/`dinputDY` (14/15). **Only App.tsx's `pointermove` handler adds to those slots** (`Atomics.add(inputView, INPUT_INDEX.dinputDX, event.movementX)`). `InputManager.injectMoveAtScreen` writes absolute `mouseX`/`mouseY` and calls `poll()` but never touches 14/15, so harness dx/dy are always 0.
  - **Small fix worth doing:** make `injectMoveAtScreen`/`injectDragAtScreen` `Atomics.add` slots 14/15 with the movement delta, and add a unit test under `tools/tests/`. Until then, drive look from the page side with synthetic `PointerEvent`s carrying `movementX/movementY`.
- **In-level W/A/S/D unverified**: a 2 s W hold changed nothing visible, but the world is black so there is nothing to measure against. Re-test once section 3 is fixed.

## 5. Performance and stability (tab visible)

| scene | fps | frame | v86 | thunk | gpu | present |
|---|---|---|---|---|---|---|
| loading / menu wipe | 60.0 | 16.7 ms | 12.1 | 4.2 | 0.13 | 0.19 |
| **Armory in-level** | **18.5** | 54 ms | 38.7 | 14.4 | 0.16 | 0.19 |

In-level thunk cost is **3x the menu cost**, so D3D9 call batching is worth more here than the menu numbers suggested. 60 fps is ~3.2x away.

**Stability soak: clean.** 6 minutes in-level, 12 samples at 30 s: guest heap **HEAP 507.68 MB / HEAP_HI 232.47 MB, identical in every sample**, fps 18.5-19.6 then 28.1 and 35.8, no crash, no exception, no allocation growth. The old 1.7 GB runaway is not reproducing.

## 6. What earlier agents established (do not redo)

- **NEWEST-29 (Claude Sonnet 5.5, Oct 1)** fixed readable menu text. The font/layout code was never the bug: Cartographer's Detours aborted all 60 hooks because our `VirtualProtect` rejected the 0x3f0000 trampoline region, so `g_ui_text_label_scaling` stayed 0.0 and every label rect collapsed. Fix in `src/worker/modules/kernel32/memory.ts` + `tools/tests/virtual-protect-low-gap.test.ts`. Before the fix, poking 0.5 into the float made labels appear - that poke is no longer needed.
- **Newest milestone (same session): first campaign gameplay reached**, and the profile `Halo0001` **survives a full page reload**, so profile selection is already persistent. A new dialog appears when a profile exists: "ARE YOU SURE? You're not signed in to Live..." (OK/Cancel).
- Already fixed and verified earlier: zero-byte `HeapAlloc`; native `xinput9_1_0.dll` replaced with an HLE no-controller module; registry/API-set aliases; CRT page-table reservation; Detours/EH4 SEH; resource/known-folder/psapi work.
- **Closed questions - do not reopen:** the menu-text bug (Detours/VirtualProtect), the `FUN_0049975a` layout hunt, FPU strict vs relaxed, v86 SSE correctness, and the "raise the RAM ceiling" theory.
- **Traps:** the test suite never boots the game and asserts no rendered pixel, so green tests are NOT evidence the game runs. `highplains.map` was a single failed open, not retry churn. Logs contain NUL bytes (use `grep -a`). Vite mis-infers stack function names - record facts on the allocation instead of scraping.
- **Useful tooling:** `h.rpc('perfProfile', [{enable:true,reset:true}])` then `perfStats`; `heapReport(n)`; `fsList`/`fsStat`/`logs`; `breakOn(addr, {pause:false, fast:true, capture:[...]})`; `inputTrace('start'|'read')`; Ghidra 12.1.4 + JDK 25 are installed and `halo2.exe` is already analysed in `work/halo2-browser/scratch/ghidra/` (decompiled guest-heap call sites in `scratch/ghidra/decompile_out.txt`). **Ghidra is the right tool if the black world turns out to be a guest-side shading decision.**

## 7. Tooling gotchas I hit (these cost me real time - here is the fix for each)

1. **Page-JS eval calls cap at ~10 s**, not the 45 s the old notes claim. Run long sequences as a *background* async function in the page writing into a `window.__x` log object, then poll it with short calls.
2. **Some harness RPCs return replies the preview tool cannot serialize** and the call comes back as `{}` (I hit this with `apiCensus` and, later, `profilerStats`). Slice/limit the result (`profilerStats([1])`, filter then stringify) and return a **string**, not an object. An empty `{}` is a tool serialization failure, not an RPC failure - do not chase it as a game bug.
3. **`fsList`/`fsStat` need full Windows paths** (`'C:\\maps'`), not relative ones; relative returns empty and looks like "no maps".
4. **`expectSurfaceNonBlack` is useless in this build**: it resolves surfaces from the ddraw module, so both `primary` and `backbuffer` fail with `surface 0x0 not found`. Use Chrome screenshots of the visible tab.
5. `apiCensus` is still the best way to prove which Win32/D3D9 entry points the guest actually calls - call it with `['suspect']` if the full list is too big.
6. Any edit under `src/` triggers a Vite reload that restarts the whole game (the "Windows Vista compatibility" dialog returns; it is not a crash). Do not edit `src/` while a session you care about is running.

## 8. Your tasks, in order. Stop after each and report before starting the next

1. **Diagnose and fix the black world** (section 3). This is the blocker for everything else. Start with the draw-pass and render-state probes; report the first concrete cause you find with evidence, even if the fix is not finished.
2. **Bundle the missing campaign maps** (section 2) from the real install, or produce a precise, verified list of what is missing and how big it is. Re-run `fsList('C:\\maps')` afterwards and prove a second mission loads.
3. **Harness mouse-look fix** (section 4) + unit test. Cheap, and it unblocks scripted camera control for every later task.
4. Then: verify W/A/S/D, campaign saves, stretched intro audio (issue #9), DualSense/gamepad -> XInput (issue #4), speed (issue #8, measure only - no recompiler/decompiler without the user's budget agreement).

## 9. Hard rules (these already wasted real money)

- Only ever write to `sstewart207/halo2-browser`. Pass `--repo sstewart207/halo2-browser` on EVERY `gh` command. Never post, comment, star, fork, open PRs or push to jenissimo/bottleship, v86 or Cartographer repos. The `upstream` remote is push-disabled on purpose. Do not merge PR #7 or close issues without the user's say-so.
- Do not use pausing breakpoints in loops, `trapWrites`, or read memory after a pause (a "paused" guest is not frozen). Use `breakOn(addr, {pause:false, fast:true, capture:[...]})`.
- Never commit `bun.lock`, bundles, game assets, saves, logs or screenshots. Keep the Chrome window **visible and normal sized** - a hidden tab throttles rendering and makes every fps number wrong.
- Use the toolchain bun at `work/toolchain/node_modules/@oven/bun-windows-x64/bin/bun.exe` (bun is not on PATH). Restart Vite with `bun.exe --bun node_modules/vite/bin/vite.js` from `work/bottleship-research`.
- Other AI models and the user edit this repo. Read the working tree before changing anything and preserve others' edits.
- Privacy: you may be a free/hosted model that logs prompts. Do not read or paste game logs, saves, account data, tokens or the private bundle; stick to source files and docs.

**Before any commit:** run `node node_modules/tsgo/bin/tsc -p tsconfig.json --noEmit` and `bun test tools/tests` (932 pass, 0 fail at the time of writing); keep both green. Push only to `origin codex/halo2-browser-checkpoint`.

**Stop and ask the user** if a tool or browser call fails three times, if you are unsure an action is outward-facing, or if you want to spend more than a few steps outside the four tasks above.

**Report format after each task (five lines max):** what you did, the exact evidence (a number, a screenshot description, or a test result), what is still unverified, the commit hash if any, and the next task you suggest.
---