# Halo 2 in the browser

Private research by Shane Stewart into running **Halo 2 Project Cartographer locally in a browser**, using [BottleShip](https://github.com/jenissimo/bottleship).

**Status: graphics initialization reached; no menu or gameplay yet.** Chrome creates a real 800×600 Direct3D9Ex device, loads Halo's precompiled pixel shaders and allocates render textures. The NT loader/semaphore startup crash is fixed. The installed Microsoft D3DX compiler now executes inside the guest, but rejects the first runtime shader with D3DERR_INVALIDCALL; Halo exits before drawing game frames. Development resumed September 30 evening.

## Goal

Run the single-player campaign in the browser without streaming or remote game execution. Add DualSense input, persistent campaign saves, and full emulator save states after gameplay works. Test desktop first, then supported mobile browsers. Multiplayer is deferred.

## Current work

- Preserve the original exception even when crash reporting floods diagnostics.
- Provide the NT loader export required by Halo's Unicode API resolver.
- Implement D3D9Ex factory/device interfaces and GPU render-target surfaces.
- Execute a selected private native DLL through `emulator.nativeDlls`, retaining HLE defaults for other bundles.
- Diagnose native D3DX shader compilation before claiming game rendering.

**Validation: 53 focused tests / 350 assertions, TypeScript and production build pass.** Chrome verifies the device and texture allocations. See [checkpoint details](docs/halo2-browser-checkpoint.md).

See the [checkpoint branch](https://github.com/sstewart207/halo2-browser/tree/codex/halo2-browser-checkpoint), [pull requests](https://github.com/sstewart207/halo2-browser/pulls), and [issues](https://github.com/sstewart207/halo2-browser/issues).

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
bun test tools/tests/version-resource.test.ts tools/tests/hle-image.test.ts tools/tests/import-supplement.test.ts tools/tests/iphlpapi-offline.test.ts tools/tests/page-table-manager.test.ts tools/tests/registry-roots.test.ts tools/tests/dll-api-sets.test.ts tools/tests/crt-wide-search.test.ts tools/tests/crt-memory-safe.test.ts tools/tests/delay-import.test.ts tools/tests/crt-vc9-seh.test.ts tools/tests/seh-catch-dispatch.test.ts tools/tests/fault-recorder.test.ts tools/tests/d3d9-ex.test.ts tools/tests/native-dll-config.test.ts tools/tests/crt-fpclass.test.ts
```

Import your own game files locally. The private test fixture contains the executable, required DLLs, main-menu map and the initial campaign/shared maps. The native-compiler trial also carries an installed Microsoft D3DX DLL. These files are local and excluded from Git. The real-file version test runs only when the developer's installed executable exists; synthetic parser tests run independently.

## Next milestones

1. Resolve native D3DX shader compilation and reach the real main menu.
2. Verify one campaign level: rendered graphics, audio, and keyboard/mouse input.
3. Persist native campaign progress across a browser restart.
4. Support DualSense controls with remapping and dead zones.
5. Implement full emulator save/restore and verify repeated round trips.
6. Measure browser/device compatibility and performance, including mobile.

Each milestone has observable acceptance checks in the issue backlog. The full engine, campaign, audio, controller input, portable saves and mobile support remain unverified.

## Files and privacy

Game executables, DLLs, maps, bundles, accounts, profiles, saves, runtime logs and local captures stay outside the repository. No game content is included here. The existing native installation and Windows security settings are preserved.

## Credits and upstream

Project owner: **Shane Stewart**. Contributors credited at Shane's request: **Shane Stewart, ChatGPT (Codex), Claude Opus 5.5, and MiMo 2.6 Flash**. OpenCode work on version resources and HLE images was also completed using **Muse Spark 1.3**.

BottleShip is by **Eugeniy Smirnov (jenissimo)** and its contributors. The original upstream README is preserved in [docs/upstream-readme.md](docs/upstream-readme.md). The original Apache 2.0 license and upstream notices remain in place. The CPU runtime is the [BottleShip v86 fork](https://github.com/jenissimo/v86), based on [v86](https://github.com/copy/v86); its own license applies.
