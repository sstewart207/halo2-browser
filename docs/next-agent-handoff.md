# Next agent: first playable build (menu text is fixed)

## October 1 product goal and next-agent handoff

User confirmed the long-term experience: open a private hosted URL on PC, Android or iPhone/iPad, load/download the game, and execute locally on that device. No streaming or remote execution. Support DualSense and other OS-recognized USB/Bluetooth controllers through the browser Gamepad API, translated into guest XInput. Add remapping, dead zones, disconnect/reconnect handling, and test wired/wireless separately on each target device. Local persistent campaign saves first; complete emulator snapshots and optional private cross-device save sync are separate later milestones.

Hosting must support HTTPS and cross-origin isolation (COOP/COEP) for SharedArrayBuffer. Cache downloaded files where supported; account for the first large download, user activation for audio, mobile suspension, browser storage eviction and memory limits. Keep game assets private and outside Git. Safari 26 has WebGPU; that is API availability, not evidence this Halo runtime works on iOS. Desktop campaign acceptance precedes Android Chrome and iOS Safari device trials. Do not promise every phone/browser or advanced DualSense haptics.

Runtime is now NEWEST-29 (Claude Sonnet 5.5, Oct 1). FIRST CAMPAIGN GAMEPLAY IS REACHED (Cairo Station opening, about 11 fps; steps in docs/halo2-boot-recipe.md). READABLE MENU TEXT IS FIXED AND CHROME-VERIFIED: the font/layout code was never the bug. Detours (Cartographer's hook layer) aborted its whole 60-hook transaction because our VirtualProtect rejected the trampoline region at 0x3f0000; the text label scale (xlive g_ui_text_label_scaling) stayed 0.0, so every label's layout rect collapsed. Read NEWEST-29 and its addendum before anything else. Do NOT resume the FUN_0049975a/FUN_004991aa hunt from NEWEST-28; it is superseded. Next (user chose option 1: first PLAYABLE build, 60fps as the following milestone): reach the main menu and test CAMPAIGN, then raise speed where cheap (thunk batching, v86 JIT tuning; currently about 14-20 fps with a visible tab), then audio stretch, DualSense/Gamepad and saves. Cartographer's hooks (including main_time_reset/game_tick) are now ACTIVE for the first time, so re-test anything previously blamed on timing. This repo is edited by several AI models and the user: read this file and the current working-tree state before touching anything, preserve others' local edits, keep bun.lock unstaged. No campaign, audio, controller or save acceptance yet.

Budget: user is nearly out of OpenAI quota, expects Gemini access in about an hour, and is considering $20-30 of Opus API credit until their Sunday reset. No API purchase or spending authorized by this note. Use a bounded single-blocker task and concise evidence; avoid full-history re-ingestion and open-ended agent loops.



## Rules for any agent, including free or smaller models (added Oct 2 by Claude Sonnet 5.5)

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
