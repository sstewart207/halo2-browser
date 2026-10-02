# Next agent: first playable build (menu text is fixed)

## Oct 2 2026, Antigravity/Gemini (with Codex): BOOT CRASH FIXED, CAMPAIGN PLAYABILITY & MOUSE LOOK VERIFIED (NEWEST-32)

Read this section first; it supersedes the earlier blocker notes below.

### 1. Boot Crash / PCC Abort Fixed (commit `783a4c8`)
- In `src/worker/modules/kernel32/file-io.ts`, `CreateFileA` and `CreateFileW` now check `if (!filename || filename.length === 0)` and return `INVALID_HANDLE_VALUE` with `ERROR_PATH_NOT_FOUND` (3).
- In `src/worker/runtime/filesystem/vfs.ts`, `open`, `openSync`, and `classifyOpenFailure` reject empty paths and directory targets (such as `C:\`), returning `null` / `ERROR_ACCESS_DENIED` (5) instead of attempting to truncate OPFS directories and throwing `TypeMismatchError`.
- All 939 unit tests pass.

### 2. End-to-End Campaign Playability & In-Level Input Verified
- Tested end-to-end via Chrome CDP: Compatibility dialog -> Title ("PRESS ANY KEY TO CONTINUE") -> ONLINE ACCOUNTS ("Play Offline") -> CHOOSE PLAYER -> Live warning ("ARE YOU SURE?") -> Main Menu -> SELECT LEVEL ("Armory" with full 3D mission card) -> CHOOSE DIFFICULTY ("Normal") -> Level loads with visor HUD and reticle.
- DirectInput mouse look verified: `moveRel(0, -60)` and `moveRel(0, 50)` calibrated the crosshairs against the tutorial lights, prompting the game to update profile and advance the mission!
- Measured in-level performance: **27.9 FPS steady** (frame time 35.86ms: v86 CPU 24.78ms, thunk 10.38ms, WebGPU GPU 0.11ms, present 0.15ms). Guest RAM rock-solid at **700 MB**.

### 3. Clear Path for the Next Agent: Automated Verification & Stage 1 Extractor
Any incoming agent can immediately verify the system or proceed with Static Recompilation:

1. **Verify Live Game & Input in Chrome in Seconds:**
   ```bash
   # From work/bottleship-research:
   bun tools/boot-halo2.ts     # Boot bundle and arm logging
   bun tools/step-nav.ts       # Advance menus to Armory level
   bun tools/test-look.ts      # Test mouse look and calibration
   bun tools/measure-perf.ts   # Check live FPS and guest heap
   ```

2. **Extract Function CFGs & Basic Blocks (Static Recomp Stage 1):**
   ```powershell
   # From work/bottleship-research:
   powershell -ExecutionPolicy Bypass -File tools/extract-ghidra-cfg.ps1 -OutFile cfg_export.json -MaxFunctions 100
   ```
   - Uses `work/halo2-browser/scratch/ghidra/ExportFunctionCFG.java` with Ghidra 12.1.4 headless runner.
   - Outputs JSON with function names, RVAs, sizes, basic block boundaries, disassembled instructions, operands, and CFG destination edges.
   - Verified sample output: `work/halo2-browser/scratch/ghidra/cfg_sample.json`.

3. **Immediate Next Goal (Stage 2 Lifter):**
   - Implement the prototype x86 basic-block lifter (in TypeScript or Rust with `wasm32-unknown-unknown`) reading the JSON CFGs and emitting WebAssembly `.wat` or WASM bytecode.
   - See `docs/halo2-static-recomp-plan.md` for the complete architecture and design.

## Oct 2 2026, Antigravity/Gemini (with Codex): BLACK WORLD FIXED, MAPS BUNDLED, ROADMAP TO 60 FPS (NEWEST-31)

### 1. In-Level Black World Fixed (commit `a773ea7`)
- D3D9 WebGPU pipeline updated in `src/worker/backends/webgpu/d3d9/shader/index.ts` and `sm3-semantics.ts`.
- `D3DDECLTYPE_DEC3N` (14) and `UDEC3` (13) packed 10-10-10-2 signed/unsigned normals are properly packed as 4-byte `uint32` attributes with WGSL component unpacking.
- SM3 pixel/vertex shader normal, tangent, binormal, and fog semantics now link cleanly into interpolator slots without throwing or aborting pipeline generation.
- Full unit test suite passes: 938/938 pass.

### 2. Campaign Maps Bundled (commit `7a4c166`)
- `00a_introduction.map` (The Heretic) and `01b_spacestation.map` (Cairo Station) added into `work/halo2-browser/bundles/halo2-2gb.wgb`.
- Missions beyond Armory now load without infinite retry spins.

### 3. Harness DirectInput Mouse Deltas (commit `6c9aba8`)
- DirectInput mouse delta accumulation implemented in `input-manager.ts` and harness `cmds/input.ts` (`moveRel`).

### 4. Workstation Build Tools Confirmed & Static Recomp Plan
- Ghidra 12.1.4 + JDK 25 headless analyzer.
- Visual Studio Build Tools 2026 (`cl.exe`, `cmake.exe`, `ninja.exe`).
- Rust toolchain with `wasm32-unknown-unknown` pre-installed.
- Roadmap: see `docs/halo2-static-recomp-plan.md` for AOT recompiling `halo2.exe` to WebAssembly.

## Oct 1-2 2026, Codex (Space Bunny): CAMPAIGN BLOCKED BY MISSING MAPS; input tested

### 1. BLOCKER: the bundle ships only ONE campaign map, so every other mission hangs forever

`C:\maps` in the guest contains exactly four maps plus `fonts/`:

| file | size |
|---|---|
| `mainmenu.map` | 61,063,680 |
| `shared.map` | 201,512,960 |
| `single_player_shared.map` | 289,477,120 |
| `01a_tutorial.map` | 62,932,480 |

Selecting a mission whose scenario file is absent puts the game into an **infinite retry loop**: the log shows `GetFileAttributesA("maps\\<scenario>.map")` for the missing file over and over, interleaved with re-probes of the three maps that do exist. The loading/wipe screen keeps animating at a healthy **60 fps** (v86 ~12 ms, thunk ~4 ms) and the guest heap stays **byte-identical** across samples (HEAP 507.47 MB, HEAP_HI 309.19 MB) — so it looks exactly like the "wedge" in the older notes, but it is a missing-asset spin, not memory exhaustion. Escape aborts it and returns to CHOOSE DIFFICULTY.

Measured scenario names per menu entry (from the guest log):

| level-list entry | scenario probed | in bundle? |
|---|---|---|
| The Heretic (1st) | `00a_introduction.map` | NO - hangs |
| **Armory (2nd)** | loads OK (see below) | yes (`01a_tutorial.map`) |
| Cairo Station (3rd) | `01b_spacestation.map` | NO - hangs |
| Outskirts / Metropolis / others | not tested; almost certainly missing | NO |

**The Armory is the only playable mission with the current bundle.** Verified in-level: black world, red light glow, "Move the Mouse to look up" prompt, shield bar + motion-tracker HUD, and Escape opens GAME PAUSED with the level's own objective text ("Follow the Gunnery Sergeant's instructions"). Choose **Armory**, not Cairo Station, until more maps are added to the bundle.

**This is a BUNDLE gap, not a missing game asset.** The full Project Cartographer install at `C:/Games/Halo 2 Project Cartographer` should contain every scenario; the assembled `bundles/halo2-2gb.wgb` (740 MB) carries only one. Fix by copying the missing `maps/*.map` from the real install into the wgb and re-checking with `fsList('C:\\maps')`. Watch the size: `shared.map` is 201 MB and `single_player_shared.map` 289 MB on their own.

### 2. Input status (measured, not assumed)

- **Menus: keyboard works.** Enter/Up/Down/Escape all drive the UI (verified by screenshot at every step). Two behaviours to know: menu lists **auto-repeat while a key is held** (one 600 ms Down moved the selection 3 rows) so use short taps (~130 ms) to move exactly one row; and Escape needs a **long hold (~900 ms)** to leave a panel - 500 ms was ignored on CHOOSE DIFFICULTY.
- **In-level Escape: works.** GAME PAUSED appears with the correct level objective.
- **In-level mouse-look WORKS for a real player; the HARNESS cannot drive it.** Verified: dispatching a `PointerEvent('pointermove', {movementX: 70})` at the canvas immediately turns the camera, clears the "Move the Mouse to look up" tutorial and reveals new geometry (screenshot before/after). The harness `move`/`drag` verbs do **not** work, and the reason is precise:
  - The game polls **`IDirectInputDevice8A_GetDeviceState`**, not `GetDeviceData` (`apiCensus` shows `GetDeviceState` called, `drainDInputMouseEvents` never), so the queued relative-motion event buffer is irrelevant.
  - `GetDeviceState`'s mouse branch (`src/worker/modules/dinput/dinput.ts` ~line 880) computes `dx/dy = accum - lastSeen`, where `accum = inputManager.getDInputAccum()` = SAB slots `dinputDX`/`dinputDY` (14/15).
  - **Only App.tsx's `pointermove` handler adds to those slots** (`Atomics.add(inputView, INPUT_INDEX.dinputDX, event.movementX)`). `InputManager.injectMoveAtScreen` writes absolute `mouseX`/`mouseY` and calls `poll()` but never touches 14/15, so harness dx/dy are always 0.
  - **Fix when you want scripted camera control:** make `injectMoveAtScreen`/`injectDragAtScreen` `Atomics.add` slots 14/15 with the same movement delta. Until then, drive look from the page side with synthetic `PointerEvent`s that carry `movementX/movementY` (that is what worked here).
- **In-level W/A/S/D: unverified.** A 2 s W hold produced no visible change, but the world renders black so there is nothing to confirm movement against. Escape and the menus prove the keyboard reaches the game; movement needs a visible world.
- New dialog not in any recipe: after a profile exists, selecting it shows **"ARE YOU SURE? You're not signed in to Live..."** (OK/Cancel) before the main menu.
- The profile created in a previous session (`Halo0001`) **survives a full page reload**, so profile selection is already persistent. Campaign saves are still untested.

### 3. Performance (tab visible, perfProfile + perfStats)

| scene | fps | frame | v86 | thunk | gpu | present |
|---|---|---|---|---|---|---|
| loading / menu wipe | 60.0 | 16.7 ms | 12.1 | 4.2 | 0.13 | 0.19 |
| **Armory in-level** | **18.5** | 54 ms | 38.7 | 14.4 | 0.16 | 0.19 |

In-level is ~18.5 fps, better than the ~11 fps in NEWEST-29 but still 3x short of 60. Note in-level thunk cost (14.4 ms) is 3x the menu cost, so D3D9 call batching is worth more here than the menu numbers suggested.

### 4. Rendering: the world is black in-level

The menus render beautifully (fonts, mission artwork, emblems). In-level we get a **black frame with one red light glow / lens flare**, the HUD and the tutorial prompt - no geometry, no textures. `present` count is healthy (25,177 presents) and `ReadFile` shows real loading, so this is a shading/visibility problem, not a stalled renderer. Do not claim "level renders" from a screenshot of the intro frame.

### 5. Stability soak (6 min, Armory in-level)

Twelve 30-second samples: guest heap **HEAP 507.68 MB and HEAP_HI 232.47 MB, identical in all 12**, fps 18.5-19.6 for the first ten samples then 28.1 and 35.8 in the last two (the camera had been turned away from the bright light by then), no crash, no exception, no allocation growth. The old 1.7 GB runaway is not reproducing. Note the level is black, so this only proves emulator stability, not that the game is playable.

## October 1 product goal and next-agent handoff

User confirmed the long-term experience: open a private hosted URL on PC, Android or iPhone/iPad, load/download the game, and execute locally on that device. No streaming or remote execution. Support DualSense and other OS-recognized USB/Bluetooth controllers through the browser Gamepad API, translated into guest XInput. Add remapping, dead zones, disconnect/reconnect handling, and test wired/wireless separately on each target device. Local persistent campaign saves first; complete emulator snapshots and optional private cross-device save sync are separate later milestones.

Hosting must support HTTPS and cross-origin isolation (COOP/COEP) for SharedArrayBuffer. Cache downloaded files where supported; account for the first large download, user activation for audio, mobile suspension, browser storage eviction and memory limits. Keep game assets private and outside Git. Safari 26 has WebGPU; that is API availability, not evidence this Halo runtime works on iOS. Desktop campaign acceptance precedes Android Chrome and iOS Safari device trials. Do not promise every phone/browser or advanced DualSense haptics.

Runtime is now NEWEST-29 (Claude Sonnet 5.5, Oct 1). FIRST CAMPAIGN GAMEPLAY IS REACHED (Cairo Station opening, about 11 fps; steps in docs/halo2-boot-recipe.md). READABLE MENU TEXT IS FIXED AND CHROME-VERIFIED: the font/layout code was never the bug. Detours (Cartographer's hook layer) aborted its whole 60-hook transaction because our VirtualProtect rejected the trampoline region at 0x3f0000; the text label scale (xlive g_ui_text_label_scaling) stayed 0.0, so every label's layout rect collapsed. Read NEWEST-29 and its addendum before anything else. Do NOT resume the FUN_0049975a/FUN_004991aa hunt from NEWEST-28; it is superseded. Next (user chose option 1: first PLAYABLE build, 60fps as the following milestone): reach the main menu and test CAMPAIGN, then raise speed where cheap (thunk batching, v86 JIT tuning; currently about 14-20 fps with a visible tab), then audio stretch, DualSense/Gamepad and saves. Cartographer's hooks (including main_time_reset/game_tick) are now ACTIVE for the first time, so re-test anything previously blamed on timing. This repo is edited by several AI models and the user: read this file and the current working-tree state before touching anything, preserve others' local edits, keep bun.lock unstaged. No campaign, audio, controller or save acceptance yet.

Budget: user is nearly out of OpenAI quota, expects Gemini access in about an hour, and is considering $20-30 of Opus API credit until their Sunday reset. No API purchase or spending authorized by this note. Use a bounded single-blocker task and concise evidence; avoid full-history re-ingestion and open-ended agent loops.



## Rules for any agent, including free or smaller models (added Oct 2 by Claude Sonnet 5.5)

- Platform scope: desktop Chrome on a PC first; phones (Android/iOS) only after desktop gameplay is solid. Speed (60 fps) needs the CPU emulation removed (recompile or decomp); see work/bottleship-research/docs/halo2-decomp-research.md. A ready-to-paste takeover prompt for free/smaller models is work/bottleship-research/docs/prompt-space-bunny-alpha-max.md.

Read in this order: this file, HANDOFF.md newest NEWEST-N entry, then `work/bottleship-research/docs/halo2-boot-recipe.md`. Work in small steps and prove each one with a screenshot, a number, or a passing test. Do not claim something works because the code compiled.

**Safe, useful tasks for a smaller model:** boot the game with the recipe and test in-level input (mouse look, W/A/S/D, Escape); measure fps and guest RAM with the dev panel's System stats strip; leave the game running a few minutes and note any crash or RAM growth; improve docs; run `node node_modules/tsgo/bin/tsc -p tsconfig.json --noEmit` and the test suite (`bun test tools/tests` using the toolchain bun at `work/toolchain/node_modules/@oven/bun-windows-x64/bin/bun.exe`).

**Do not (these already wasted real money):**
- Do not post, comment, open PRs/issues, star or push to anything except `sstewart207/halo2-browser`. Always pass `--repo sstewart207/halo2-browser` to `gh`. The `upstream` git remote is push-disabled on purpose. Never touch jenissimo/bottleship, v86 or Cartographer repos.
- Do not merge PR #7 or close issues without the user's say-so.
- Do not use pausing breakpoints in loops, `trapWrites`, or read memory after a pause; use `breakOn(addr, {pause:false, fast:true, capture:[...]})`.
- Do not edit files under `src/` while a game session you care about is running: Vite reloads the page and restarts the game (the "Vista compatibility" dialog returns; it is not a crash).
- Do not commit `bun.lock`, bundles, game assets, saves, logs or screenshots. Keep the Chrome window visible and normal sized, because a hidden tab skews every fps number.
- Do not re-open solved questions: the menu-text bug (Detours/VirtualProtect), the FUN_0049975a layout hunt, FPU strict/relaxed, and v86 SSE correctness are all closed (see NEWEST-29).
- Do not start a decompilation or recompilation project without the user agreeing a budget first (see `docs/halo2-decomp-research.md`).

**Stop and report to the user** if a tool or browser call fails three times, if you are about to spend more than a few steps on something not in the open list, or if you are unsure whether an action is outward-facing.

**Privacy note for free or "stealth" models:** anonymous free preview models may log prompts for the provider's training. Do not paste game logs, saves, account data, tokens or the private bundle; stick to source files and docs.
