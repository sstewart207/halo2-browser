# Halo 2 in the browser

Private research by Shane Stewart into running **Halo 2 Project Cartographer locally in a browser**, using [BottleShip](https://github.com/jenissimo/bottleship).

**Status: startup blocked. Halo 2 has not reached its menu or gameplay.** Native x86 code executes in Chrome and passes Cartographer's version checks. The CRT crash is fixed: emulator page tables were overwriting the executable. Startup now reaches a PC compatibility error because Microsoft XML COM support is missing. The checkpoint PR holds the compatibility changes; the project is not yet playable.

## Goal

Run the single-player campaign in the browser without streaming or remote game execution. Add DualSense input, persistent campaign saves, and full emulator save states after gameplay works. Test desktop first, then supported mobile browsers. Multiplayer is deferred.

## Current work

- Read the executable's actual PE version resources instead of fabricated game metadata.
- Provide mapped Windows-module export images for guest code that resolves APIs itself.
- Correct export-name ordering and distinguish executable exports from forwarded exports.
- Supply missing x86 import signatures, offline IP Helper behavior, and accurate unsupported DPAPI failures.
- Keep debug logs and diagnostic panels readable when the window is resized or zoomed.
- Capture bounded crash-memory samples and reserve page tables outside loaded PE images.
- Trace the native PCCompat checker and its Microsoft XML COM dependency.

TypeScript passes. The checkpoint's focused suite passes **30 tests / 184 assertions**. Chrome passes the former `0xe7618007` crash and reaches compatibility dialogs; passing tests do not establish gameplay.

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
bun test tools/tests/version-resource.test.ts tools/tests/hle-image.test.ts tools/tests/import-supplement.test.ts tools/tests/iphlpapi-offline.test.ts tools/tests/page-table-manager.test.ts tools/tests/registry-roots.test.ts
```

Import your own game files locally. The private boot fixture currently contains the executable, required DLLs and the main-menu map; it does not include campaign maps. The real-file version test runs only when the developer's installed executable exists; synthetic parser tests run independently.

## Next milestones

1. Supply the missing XML compatibility dependency and reach the real main menu.
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
