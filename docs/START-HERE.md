# START HERE — Halo 2 in the browser (AOT)

For whoever picks this up cold, with no prior context. Read this file only; everything it links to is detail, not prerequisite.

## The goal

Run Halo 2 Project Cartographer **in a browser, natively**. A booting menu screen and a playable campaign. Windows PC, Chrome first. Phones later.

## Where the project actually is

**Not working yet.** No menu, no rendered frame, no audio. That is the honest state and has been for a while.

What does work: a WebAssembly build of the game that boots far into Halo 2's own startup code — all four native DLLs attach, the EXE runs its CRT startup, TLS, and static constructors, and the game allocates memory and opens its window before it stops. It stops at one specific place, described below.

Do not read older notes as if they claim more progress than this. A few checkpoints describe game runs; those are from a different, older approach that has been abandoned.

## How it works

x86 code is **recompiled ahead of time into WebAssembly** and executed natively in the browser. There is **no CPU emulation and no v86 fallback** — that approach was dropped. If a plan you read involves handing code to an emulator, it is out of date.

The game is loaded from a private bundle (`.wgb`), which stays out of Git.

## The one thing blocking you

The boot stops at address `0x1970421`. Read this carefully, because it is the whole problem:

```
VirtualAlloc -> 0x1970000 (size=4096)      rwx
[AOT unresolved] target=0x1970421 esp=0x12ffb90 return=0x408f4a
```

The game **builds that 4 KB page at runtime**, copies EXE code into it, patches three regions, splices in a call to a profiling hook, then jumps into it. The stop is at offset `0x421` inside that freshly built page.

This means the gap is **architectural, not a missing function**. The recompiler works from static images; this code does not exist in any static image, so no amount of recovery or re-analysis will reach it. It will keep saying "unresolved indirect call" forever until something executes it.

The way forward: **decode those runtime bytes in the browser and execute them**, then transfer control to the already-compiled profiling hook. Concretely — use an x86 decoder (iced-x86 has a JS/WASM build and already decoded this exact prefix correctly in a private spike) to read the patched bytes out of live guest memory, run them against real register and flag state, then hand off to the hook.

**Prove it in a synthetic test first** — decode a prefix, execute it, make the hook transition correctly — before running the whole game. A test that constructs the exact instruction sequence and checks the transition is far cheaper than a 30-second browser boot.

The condition-flag registers were recently made to survive call boundaries specifically because this hook needs them. That groundwork is done and committed.

## Detail, when you need it

- `docs/CHECKPOINT-93.md` — full evidence, exact commands, all gotchas. **Start here when you start working.**
- `docs/next-agent-handoff.md` — running log of every checkpoint, newest first.
- `docs/halo2-boot-recipe.md` — ⚠️ mostly describes the **abandoned** approach. Read only its warnings.

## Setup

Everything below is verified working right now.

```bash
# from work/bottleship-research
bun test tools/tests                    # 1094 pass, 0 fail
node node_modules/tsgo/bin/tsc -p tsconfig.json --noEmit    # clean
```

To build, the recompiler script must be **re-bundled first**. This trips up everyone:

```bash
./node_modules/.bin/esbuild tools/recompile-native-cfg.ts --bundle --platform=node \
  --format=cjs --outfile=dist-recompile.cjs --log-level=error
node --max-old-space-size=8192 dist-recompile.cjs <manifest>.json
```

Skipping the re-bundle silently produces a byte-identical WASM and the same error — it looks like your change did nothing.

To boot: start the dev server on port 5174, then let the tooling launch Chrome itself over debug port **9333** (not 9222):

```bash
timeout 180 bun tools/boot-halo2.ts
sleep 45
timeout 90 bun tools/read-chrome-logs.ts > tmp/logs.txt 2>&1    # never exits; timeout is expected
```

Keep the Chrome window **visible and normal-sized**. A backgrounded or minimized tab throttles rendering and makes every measurement meaningless.

## Rules that exist for a reason

- **Verify with evidence.** A screenshot, a number, or a passing test. Compiling is not evidence that anything runs. Never report a working feature without having run it.
- **Don't weaken safety or fake results.** Do not stub or bypass the game's security cookie check. Do not make an API return success that you have not implemented.
- **Guess arity from the guest code, never from a header.** The number of arguments the game actually pushes is the only authority. Wrong counts corrupt the stack and surface much later as an unrelated crash, which wastes hours.
- **Keep private data out of Git**: game assets, bundles, logs, memory dumps, saves, the built WASM, and lock files.
- **Several people share this working copy.** Check `git status` and the current branch before staging anything, and never stage everything at once.

## If you only remember three things

1. The goal is a browser that boots Halo 2. It boots a long way. It does not yet reach a menu.
2. The single blocker is code the game generates at runtime. Static recompilation cannot reach it by definition — it has to be decoded and executed.
3. Re-bundle the recompiler after editing the lifter, or your change does nothing at all.