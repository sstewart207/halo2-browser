# Prompt for Space Bunny Alpha Max (or any free/smaller model taking over)

Paste everything below the line as the first message of a new session, with the repo checked out at `work/bottleship-research` on branch `codex/halo2-browser-checkpoint`.

---

You are taking over a private hobby project: running the real Windows game Halo 2 (with the community Project Cartographer mod) locally in desktop Chrome, via an x86 emulator (v86) plus a "fake Windows" layer (BottleShip) and a D3D9-to-WebGPU renderer. The user is a first-time big-project builder with a very small budget, so be economical: few tool calls, short answers, no long explanations.

**Goal order:** (1) a first PLAYABLE build on desktop Chrome, (2) 60 fps, (3) DualSense/gamepad controls. Phones come later. Never stream or run the game remotely.

**Current state (verified Oct 1-2 2026):** menu text renders; the campaign loads from the menus and reaches the Cairo Station opening with the HUD at about 11 fps. NOT verified: mouse look and movement in the level, audio (the user hears stretched intro audio), saves, stability over minutes, controller input.

**Read first, in this order:** `AGENTS.md` (workspace root, one level above the repo; also mirrored in `docs/next-agent-handoff.md`), the newest NEWEST-N entry and the "MILESTONE" section in `docs/halo2-browser-checkpoint.md`, then `docs/halo2-boot-recipe.md`. Skim `docs/halo2-decomp-research.md` only if asked about speed strategy.

**Your tasks, in order. Stop after each and report before starting the next:**
1. Boot the game with `docs/halo2-boot-recipe.md` (keep the Chrome window visible). In the Cairo Station level, test input: inject mouse movement and hold W/A/S/D, Escape, and confirm the view or HUD changes. Leave it running about 5 minutes and note any crash, freeze or guest RAM growth (the System stats strip in the dev panel shows FPS, guest RAM, VRAM estimate). Write results into the handoff docs and comment on issue #2.
2. DualSense/gamepad (issue #4). Today `src/worker/modules/xinput9_1_0.ts` always returns ERROR_DEVICE_NOT_CONNECTED (1167). Main-thread gamepad code exists in `src/gamepad-cache.ts` and `src/app/App.tsx`. Design the smallest change that feeds the browser Gamepad API state to the guest's `XInputGetState` (map the standard gamepad buttons and sticks to XINPUT_STATE, with a dead zone), add a unit test under `tools/tests/`, then verify in the real game with a connected controller if one is available. If no controller is available, say so; do not claim it works.
3. Speed (issue #8): only measure. Use `perfProfile` + `perfStats` to find which D3D9 API calls dominate the roughly 22 ms/frame of thunk time and write the top 10 into the handoff docs. Do not attempt a recompiler or decompiler.

**Hard rules (these already wasted real money):**
- Only ever write to `sstewart207/halo2-browser`. Pass `--repo sstewart207/halo2-browser` on EVERY `gh` command. Never post, comment, star, fork, open PRs or push to jenissimo/bottleship, v86 or Cartographer repos. The `upstream` remote is push-disabled on purpose. Do not merge PR #7 or close issues without the user's say-so.
- Do not use pausing breakpoints in loops, `trapWrites`, or read memory after a pause (a "paused" guest is not frozen). Use `breakOn(addr, {pause:false, fast:true, capture:[...]})`.
- Editing files under `src/` makes Vite reload the page and restart the game; the "Windows Vista compatibility" dialog that returns is the game's own startup check, not a crash.
- Never commit `bun.lock`, bundles, game assets, saves, logs or screenshots. Use the toolchain bun at `work/toolchain/node_modules/@oven/bun-windows-x64/bin/bun.exe` (bun is not on PATH).
- Closed questions, do not reopen: menu-text bug (Detours/VirtualProtect, fixed), FUN_0049975a layout hunt, FPU strict vs relaxed, v86 SSE correctness.
- Other AI models and the user edit this repo. Read the working tree before changing anything and preserve others' edits.
- Privacy: you may be a free preview model that logs prompts. Do not read or paste game logs, saves, account data, tokens or the private bundle.

**Before any commit:** run `node node_modules/tsgo/bin/tsc -p tsconfig.json --noEmit` and `bun test tools/tests` (currently 932 pass, 0 fail); keep both green. Commit messages end with a `Co-Authored-By:` line for your model. Push only to `origin codex/halo2-browser-checkpoint`.

**Stop and ask the user** if a tool or browser call fails three times, if you are unsure an action is outward-facing, or if you want to spend more than a few steps outside the three tasks.

**Report format after each task (five lines max):** what you did, the exact evidence (a number, a screenshot description, or a test result), what is still unverified, the commit hash if any, and the next task you suggest.
