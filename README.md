# Halo 2 in the browser

Private research by **Shane Stewart** into running Halo 2 Project Cartographer locally in Chrome through [BottleShip](https://github.com/jenissimo/bottleship). The game executes on the browser's machine; no streaming or remote game execution.

The implementation and runtime checks below refer to the [checkpoint branch](https://github.com/sstewart207/halo2-browser/tree/codex/halo2-browser-checkpoint) and [PR #7](https://github.com/sstewart207/halo2-browser/pull/7). That source work has not yet been merged into `main`.

## Current achievement

The real animated Halo 2 title screen and menu panels render in Chrome. Keyboard input advances the title screen into the menu. This is original guest rendering, not a recreated web menu. Readable menu labels are the current acceptance blocker; campaign gameplay is not yet verified.

Implemented and verified incrementally: native Windows startup compatibility, shader compilation, correct shader bytecode parsing and SM3 semantics, multiple vertex streams, texture transfers and surface copies, volume textures, resource ownership, render-target restoration, indexed strips and programmable MRT output. Fixing resource lifetime reduced a 1.7 GB guest-memory leak to roughly 750 MB.

Font files and glyph rasterization work. The fixed 128 KB glyph pixel cache starved requested characters, causing entire strings to be skipped. A build-guarded in-memory patch expands backing storage and its matching block count while preserving original entry capacities. The checkpoint uses 1 MB. Live character lookups and whole-string validation now pass for sampled title/account-menu text; readable labels remain blocked farther down the layout path. Glyph-handle and visible-label checks are documented separately in the [latest checkpoint](https://github.com/sstewart207/halo2-browser/blob/codex/halo2-browser-checkpoint/docs/halo2-browser-checkpoint.md); allocated glyphs alone do not establish readable menu text.

**Validation: 929 tests pass; TypeScript clean.** Separate Chrome probes verify GPU surface-copy pixels and local decoding of 120 non-black WMV frames. Integrated intro playback and correct audio remain unverified. Synthetic tests are not gameplay acceptance.

## Goal and next steps

The intended experience is a private hosted link: load the game and play locally in a browser on PC, Android or iPhone/iPad, with USB/Bluetooth controllers and persistent saves. Desktop campaign gameplay comes first. Mobile performance, Safari compatibility, controller input and emulator snapshots remain unverified. Hosting and delivery will use HTTPS, cross-origin isolation and browser caching; game assets stay private. See the [next-agent handoff](https://github.com/sstewart207/halo2-browser/blob/codex/halo2-browser-checkpoint/docs/next-agent-handoff.md).

1. Finish readable menu labels and keyboard navigation.
2. Verify one single-player campaign level with graphics, audio and keyboard/mouse input.
3. Persist native campaign progress across browser restarts.
4. Add USB/Bluetooth DualSense and compatible gamepad controls through the Gamepad API and guest XInput, with remapping, dead zones and reconnect handling.
5. Implement and repeatedly verify complete emulator save/restore.
6. Measure performance and memory on Android Chrome and iOS Safari; verify suspend/resume, audio activation and storage persistence.
7. Provide private hosted delivery with cached downloads; optional private cross-device save sync follows reliable local saves.

Multiplayer is deferred. Private game files, bundles, profiles, saves and runtime captures stay out of Git.

Work lives on the [checkpoint branch](https://github.com/sstewart207/halo2-browser/tree/codex/halo2-browser-checkpoint), with [PR #7](https://github.com/sstewart207/halo2-browser/pull/7) and [menu issue #1](https://github.com/sstewart207/halo2-browser/issues/1). See [research references](https://github.com/sstewart207/halo2-browser/blob/codex/halo2-browser-checkpoint/docs/halo2-research-leads.md) for engine/tooling leads.

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

Project owner: **Shane Stewart**. Contributors credited at Shane's request: **Shane Stewart, ChatGPT (Codex), Claude Opus 5.5, and MiMo 2.6 Flash**. OpenCode work on version resources and HLE images was also completed using **Muse Spark 1.3**.

BottleShip is by **Eugeniy Smirnov (jenissimo)** and its contributors. The original upstream README is preserved in [docs/upstream-readme.md](https://github.com/sstewart207/halo2-browser/blob/codex/halo2-browser-checkpoint/docs/upstream-readme.md). The original Apache 2.0 license and upstream notices remain in place. The CPU runtime is the [BottleShip v86 fork](https://github.com/jenissimo/v86), based on [v86](https://github.com/copy/v86); its own license applies.
