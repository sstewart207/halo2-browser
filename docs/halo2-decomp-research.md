# Halo 2 decompilation / recompilation research notes

Oct 2 2026 (Claude Sonnet 5.5), from web searches only. Nothing here was run or verified locally; treat numbers as other people's claims. Goal context: the current v86 emulator path reaches Halo 2 campaign gameplay at about 11 fps; 60 fps needs the CPU emulation removed (issue #8).

## What is out there

- **Halo CE browser port (Oct 1 2026).** Free, unofficial port of the original Xbox Halo: Combat Evolved by Mitchell Hynes, built on a decompilation of the Xbox game ([halo-ce-universal](https://github.com/cybersecurity/halo-ce-universal), reported 99.5% byte-matching for Xbox build 2342) compiled to WebAssembly + WebGL 2 ([Halo-Mobile](https://github.com/OMG-Guest/Halo-Mobile)). Reported about 94 FPS average; author says iOS/Android do not run well. Its speed comes from the decomp, not from the model that helped port it. [TechPowerUp report](https://www.techpowerup.com/353285/halo-combat-evolved-gets-a-free-browser-port-with-split-screen-co-op).
- **Halo CE decompilation is LLM-assisted.** [halo-re/halo](https://github.com/halo-re/halo), [stianeklund/halo](https://github.com/stianeklund/halo) (LLM-assisted tooling validated against binary evidence), [blam.info](https://blam.info/).
- **Halo 2: no decompilation project found.** Searches returned only Halo CE projects. Halo 2 PC (Vista) has [Project Cartographer's open-source code](https://github.com/pnill/cartographer) (checked out locally at `work/cartographer-source`), which already names many halo2.exe structures, addresses and hook points. That is a real head start for naming and types.

## How matching decompilation works (and what Claude can do)

- "Matching" = write C that, compiled with the ORIGINAL compiler and flags, produces byte-identical machine code. Needs the exact toolchain plus a diff tool (objdiff-style) and usually a permuter for the last few percent.
- Public write-ups: [The Long Tail of LLM-Assisted Decompilation](https://blog.chrislewis.au/the-long-tail-of-llm-assisted-decompilation/), [60-function test, 74% matched](https://gambiconf.substack.com/p/can-llms-really-do-matching-decompilation), [Claude Code and 51% of a 2001 GBA game](https://gambiconf.substack.com/p/starting-a-decompilation-project), [one-shot decompilation with Claude](https://simonwillison.net/2025/Dec/6/one-shot-decompilation/). Those targets are small compared with Halo 2 (halo2.exe is about 14.7 MB).

## Options for Halo 2 (nothing started)

1. **Matching decomp.** Cleanest and best for preservation, but needs the original compiler setup and is the most expensive. Probably not the right first move.
2. **Functional decomp** (readable C that behaves the same, not byte-identical): Ghidra pseudocode we already generate (`work/halo2-browser/scratch/ghidra`) cleaned by an LLM, then compiled with Emscripten. Cheaper than matching, riskier for subtle behavior differences. Still tens of thousands of functions; no cost estimate exists.
3. **Static recompilation** (translate halo2.exe machine code to WASM ahead of time, no readable source). Most automatable; the fake-Windows layer (BottleShip) stays. Likely the fastest route to removing the CPU emulator.

## Cheap experiments that would decide it (not run)

- Count functions in the existing Ghidra project and measure LLM cost and success per function on a sample of about 50 (functional decomp).
- Translate one hot guest function (see the flat profile in issue #8) to WASM and measure the real speedup (static recomp).

## Legal / hygiene

Use only your own legally owned binary and Cartographer's open-source code. Do not use leaked source. Keep game assets, bundles and saves out of Git. Do not post to upstream repos without the owner's approval.

## How the 60 fps browser ports get their speed (web research, Oct 2 2026; not verified locally)

- **No CPU emulation.** The game's logic runs as native-speed WebAssembly: Halo CE from its decompiled C source ([Halo-Mobile](https://github.com/OMG-Guest/Halo-Mobile)), Pepsiman (PS1) from [PSXRecomp](https://heldgames.com/guides/ps1-recompilation-explained), which mechanically rewrites the original machine code as C and compiles it to WebAssembly ([Notebookcheck](https://www.notebookcheck.net/A-recompiled-version-of-Pepsiman-lets-you-play-the-PS1-cult-classic-natively-in-your-browser-at-60-FPS.1354060.0.html)). No per-frame instruction translation.
- **Modern web plumbing around it:** WebGL 2, WebAssembly threads, OffscreenCanvas in a worker (an experimental direct worker-canvas mode cuts frame transport), OPFS for storage, service workers; cross-origin isolation required, same as this project.
- **Caveats:** both targets are small, old engines with purpose-built tooling, and the Halo CE author reports poor iOS/Android performance. There is no equivalent turnkey tool for a 14 MB Windows x86 game like halo2.exe.
- **What carries over here:** the BottleShip fake-Windows and D3D9-to-WebGPU layers stay. Recompiled code would call them directly instead of through emulator OUT-port traps, which should also cut the roughly 22 ms/frame thunk cost.
