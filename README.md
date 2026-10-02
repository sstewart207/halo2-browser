# Halo 2 in the browser

Private research by **Shane Stewart** into running Halo 2 Project Cartographer locally in Chrome through [BottleShip](https://github.com/jenissimo/bottleship). The game executes on the browser's machine; no streaming or remote game execution.

The implementation and runtime checks below refer to the [checkpoint branch](https://github.com/sstewart207/halo2-browser/tree/codex/halo2-browser-checkpoint) and [PR #7](https://github.com/sstewart207/halo2-browser/pull/7). That source work has not yet been merged into `main`.

## Current achievement

The real animated Halo 2 title screen, menu panels, and full 3D campaign levels render in Chrome. Keyboard and mouse input drive the game end-to-end. This is original game rendering and logic, not a recreated web menu:
- **Readable text & menus:** Fixed Detours transaction failure (`VirtualProtect` on low-gap allocations), rendering all menu text, account screens, and campaign selection panels readably.
- **In-level 3D world rendering fixed:** Fixed the in-level black world blocker. The D3D9 WebGPU pipeline now packs `D3DDECLTYPE_DEC3N` and `UDEC3` (10-10-10-2 formats) as 4-byte `uint32` attributes with WGSL unpacking and maps SM3 `NORMAL`, `TANGENT`, `BINORMAL`, and `FOG` interpolator semantics without dropping draw calls.
- **Campaign maps bundled:** Assembled `00a_introduction.map` (The Heretic) and `01b_spacestation.map` (Cairo Station) alongside Armory (`01a_tutorial.map`), unblocking single-player campaign progression beyond the tutorial.
- **DirectInput mouse look:** DirectInput delta accumulation implemented in the runtime and test harness (`moveRel`), enabling full camera rotation and aiming.
- **Validation:** **938 tests pass; TypeScript clean.**

## Architecture & the 60 FPS Pivot: Static Recompilation (AOT x86 → WASM)

While Halo 2 executes successfully under x86 emulation, CPU emulation presents a hard ceiling:
1. **The 20 FPS Ceiling:** In-browser x86 JIT compilation spends ~38 ms/frame in the CPU emulator, rendering in-level gameplay at ~14–19 FPS.
2. **The Thunk Tax:** Calling Win32 and Direct3D APIs via emulator `OUT`-port traps costs ~15–20 ms/frame in context switches alone.
3. **iOS Safari Compatibility:** Apple strictly prohibits runtime JIT in WebKit browsers, dropping emulator performance to an unplayable 2–4 FPS interpreter.

### The Solution: Static Recompilation
Following the approach of modern 60 FPS browser ports (e.g. N64Recomp, PSXRecomp/Pepsiman), we are executing a **Static Recompilation (AOT x86 → WebAssembly)** architecture:
- **BottleShip stays intact:** BottleShip's D3D9-to-WebGPU shader recompiler, vertex packer, render pass manager, and Win32 HLE implementations remain the core graphics and OS engine.
- **Eliminating the CPU emulator:** `halo2.exe`'s 15,893 core functions are mechanically lifted ahead-of-time into WebAssembly.
- **Zero-latency API calls:** Win32/D3D9 calls become direct imported WebAssembly function calls into BottleShip (no emulator trap latency).
- **Target:** **Steady 60 FPS** on desktop and native compatibility with iOS Safari. Full architecture details are documented in [docs/halo2-static-recomp-plan.md](https://github.com/sstewart207/halo2-browser/blob/codex/halo2-browser-checkpoint/docs/halo2-static-recomp-plan.md).

## Goal and next steps

The intended experience is a private hosted link: load the game and play locally in a browser on PC, Android or iPhone/iPad, with USB/Bluetooth controllers and persistent saves.

1. **Campaign verification:** Verify in-level combat, audio, and checkpoint progression in Cairo Station and Armory.
2. **Recompilation pipeline:** Extract CFGs, basic blocks, and jump tables via headless Ghidra and generate WebAssembly targeting the BottleShip runtime.
3. **Input & controllers:** Add USB/Bluetooth DualSense and compatible gamepad controls through the Gamepad API and guest XInput.
4. **Saves & persistence:** Persist campaign checkpoints to OPFS / IndexedDB across page reloads.
5. **Cross-platform benchmarks:** Measure 60 FPS performance on desktop Chrome and test WebGPU on iOS Safari.

## Development

Start from the checkpoint branch to use the Halo compatibility work:

```powershell
git clone --branch codex/halo2-browser-checkpoint https://github.com/sstewart207/halo2-browser.git
cd halo2-browser
git submodule update --init --recursive
bun install
bun run dev
```

Bun and a current Chromium browser with WebGPU are required by the runtime. In the existing Windows workspace, the working Bun binary is `../toolchain/node_modules/@oven/bun-windows-x64/bin/bun.exe`. Check the terminal for the actual Vite port.

```powershell
bun run typecheck
bun test tools/tests/version-resource.test.ts tools/tests/hle-image.test.ts tools/tests/import-supplement.test.ts tools/tests/iphlpapi-offline.test.ts tools/tests/page-table-manager.test.ts tools/tests/registry-roots.test.ts tools/tests/dll-api-sets.test.ts tools/tests/crt-wide-search.test.ts tools/tests/crt-memory-safe.test.ts tools/tests/delay-import.test.ts tools/tests/crt-vc9-seh.test.ts tools/tests/seh-catch-dispatch.test.ts tools/tests/fault-recorder.test.ts tools/tests/d3d9-ex.test.ts tools/tests/native-dll-config.test.ts tools/tests/crt-fpclass.test.ts tools/tests/crt-multibyte-length.test.ts
```

Import your own game files locally. The private test fixture contains the executable, required DLLs, main-menu map and the initial campaign/shared maps. The native-compiler trial also carries installed Microsoft D3DX31, D3DX43 and D3DCompiler43 DLLs. These files are local and excluded from Git. The real-file version test runs only when the developer's installed executable exists; synthetic parser tests run independently.

## Files and privacy

Game executables, DLLs, maps, bundles, accounts, profiles, saves, runtime logs and local captures stay outside the repository. No game content is included here. The existing native installation and Windows security settings are preserved.

## Credits and upstream

Project owner: **Shane Stewart**. Contributors credited at Shane's request: **Shane Stewart, Google DeepMind Antigravity (Gemini), ChatGPT (Codex), Claude Opus 5.5, and MiMo 2.6 Flash**. OpenCode work on version resources and HLE images was also completed using **Muse Spark 1.3**.

BottleShip is by **Eugeniy Smirnov (jenissimo)** and its contributors. The original upstream README is preserved in [docs/upstream-readme.md](https://github.com/sstewart207/halo2-browser/blob/codex/halo2-browser-checkpoint/docs/upstream-readme.md). The original Apache 2.0 license and upstream notices remain in place. The CPU runtime is the [BottleShip v86 fork](https://github.com/jenissimo/v86), based on [v86](https://github.com/copy/v86); its own license applies.
