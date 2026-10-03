# Halo 2 in the browser

Private research by **Shane Stewart** into running **Halo 2 Project Cartographer locally in a web browser**, using BottleShip and ahead-of-time x86 → WebAssembly recompilation. No streaming or remote game execution.

## Current status — October 3, 2026

**The recompiled game reaches native startup in desktop Chrome, but the AOT title screen, menu, campaign and steady 60 FPS are not yet verified.** Compiling the binary is a toolchain milestone, not proof of complete instruction support or playable gameplay.

Active code is on [codex/halo2-browser-checkpoint](https://github.com/sstewart207/halo2-browser/tree/codex/halo2-browser-checkpoint), tracked by [PR #7](https://github.com/sstewart207/halo2-browser/pull/7). This README on `main` describes that work; it does not mean the implementation PR has been merged.

### Verified progress

- Ghidra CFG extraction and whole-program WASM generation: the latest build covers **31,185 functions across the EXE, D3DX and Cartographer DLL**. Additional observed indirect-call entries are recovered as startup exposes them.
- Chrome compiles and instantiates the actual generated WASM over guest memory. Execution proceeds through real CRT paths and Win32 HLE calls, including version checks, heap allocation, locks and TLS/FLS operations.
- Corrected stack and calling-convention bugs: mutable shared ESP, stdcall cleanup, multi-block returns, external/indirect tail calls, SEH epilog stack restoration and CALL-IAT/RET wrappers.
- Fixed CMP borrow/overflow, HLE export jump trampolines and API import parsing for names such as `ws2_32`.
- Diagnosed a startup hang in the CRT cosine routine: unsupported `JP` had become an unconditional jump. Shared binary64 x87 state, stack push/pop, double memory access, cosine, status/control words, SAHF/parity branches and rounding-mode conversion now pass targeted tests. **The real Chrome boot gets past the previous cosine blocker.** Full x87 fidelity is still incomplete.
- **1,064 tests pass; TypeScript checks clean.** Synthetic tests do not establish gameplay or rendering acceptance.

Earlier CPU-emulation checkpoints recorded title/menu rendering and Armory campaign work. Those results belong to the earlier v86 execution path; they do not establish AOT rendering, AOT performance, or mobile compatibility.

### Current work

Latest verified Chrome boot (NEWEST-57): **D3DX completes initialization and Cartographer executes farther through native CRT and constructor code.** Locked increment, bit tests, SSE lane shuffling and conditional moves are implemented. A nine-argument Windows API previously received only four; the AOT bridge now uses registered argument metadata. Recovered 43 omitted constructor entries.

The private module contains 31,185 functions (82.4 MB). CVTDQ2PD, ADDSD and CVTPD2PS now pass real Chrome startup. MOVQ, packed shifts, bit masks/subtraction and comparison now pass the CRT math routine. Bit scans and packed CRT string operations now pass Chrome, along with two further Ghidra-recovered native entries. Cartographer now enumerates display modes through native code. Current explicit stop: unresolved native target `0x13059b30`. Next: recover that entry, finish xlive startup, then remaining DLLs and true TEB/TLS. Experimental EXE shell-success/synchronous-job substitutions still require review. No AOT video/menu, playable campaign or 60 FPS result is verified.

## Goal

Open a private hosted URL, load the game assets, and play with execution on the user's device.

1. Desktop Chrome: real title/menu, campaign graphics, audio, input and saving, then measured 60 FPS.
2. USB/Bluetooth controllers, including DualSense, through browser controller input.
3. Persistent local saves; later session snapshots and optional private cross-device sync.
4. Android and iOS browser compatibility and performance testing.
5. Private room multiplayer / browser LAN-style play after single-player works.

These are goals, not completed features. Browser controller support, mobile performance, snapshots and multiplayer are unverified.

## Development

Use the checkpoint branch and read [the latest AOT checkpoint](https://github.com/sstewart207/halo2-browser/blob/codex/halo2-browser-checkpoint/docs/halo2-aot-boot-checkpoint.md) before continuing. The local workspace also has `AGENTS.md`, `CODEX-HANDOFF.md` and `HANDOFF.md`; use their newest numbered checkpoint.

```powershell
git clone --branch codex/halo2-browser-checkpoint https://github.com/sstewart207/halo2-browser.git
cd halo2-browser
git submodule update --init --recursive
bun install
bun run dev

node node_modules/tsgo/bin/tsc -p tsconfig.json --noEmit
bun test tools/tests
```

Run the dev server on port 5174 for the existing Chrome workflow. Game assets and the local extracted CFG are supplied privately and are not included in the repository. The current private multi-image build uses `native-build53.json`, described in the latest handoff.

```powershell
# Optional bounded startup diagnostic; omit for an ordinary build.
$env:AOT_DEBUG_BLOCK_LIMIT = '1000000'
bun tools/recompile-cfg.ts <private-cfg-path> <private-output-prefix>
Remove-Item Env:AOT_DEBUG_BLOCK_LIMIT
```

Use one agent editing and boot-testing at a time. Preserve other contributors' uncommitted files, keep `bun.lock` unstaged, and record the exact build, test results and Chrome failure before handing off.

## Privacy and credits

Game executables, DLLs, maps, bundles, accounts, profiles, saves, runtime logs and captures remain private and outside Git. No proprietary game assets are distributed here.

- Project owner: **Shane Stewart**.
- AI development contributors: **ChatGPT (Codex), Claude Opus 5.5, MiMo 2.6 Flash, Muse Spark 1.3 through OpenCode, and Google DeepMind Antigravity/Gemini**. Work has multiple contributors; checkpoints record verified changes rather than assuming authorship.
- **BottleShip** is by **Eugeniy Smirnov (jenissimo)** and contributors. Its original README is preserved in [docs/upstream-readme.md](docs/upstream-readme.md), under Apache 2.0.
