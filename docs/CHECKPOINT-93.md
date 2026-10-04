# CHECKPOINT — NEWEST-93 (October 3, 2026)

**`xlive.dll` no longer blocks the build; Build 92 is built, deployed and booted. The boot stops at the same `0x1970421` as Build 91, and the log now proves that address is inside a page the guest allocated two log lines earlier.** Still no AOT menu/video/campaign/60-fps acceptance.

This supersedes `CHECKPOINT-92.md` (diagnosis) and `CHECKPOINT-91.md`. Its private forensic artifacts still exist and are still valid; only the "next step" is now partly done.

## 1. The missing DLL was missing, not blocked

Earlier checkpoints reported Windows Defender blocking reads of `xlive.dll`. That was a misdiagnosis. The file did not exist:

- `work/halo2-browser/scratch/ghidra/xlive.dll` — absent
- `C:\Games\Halo 2 Project Cartographer\xlive.dll` — absent, and no `xlive*` under `C:\Games` at all
- No copy in either checkout, no git history, no Defender quarantine directory

A Defender exclusion governs reads of files that exist; there was nothing to read, so no exclusion could have helped. **Defender was never touched** (workspace rule: the user manages it independently). No Linux workaround is needed.

The Ghidra project still held the complete analysis, so the PE was reconstructed from it — see below.

## 2. Reconstructed the PE from the Ghidra database

New private script `../halo2-browser/scratch/ghidra/ExportPeImage.java` (do not commit generated assets, but the script is small and worth re-running if another DLL vanishes):

- Walks the program's initialized memory blocks and writes a **flat image** where file offset == RVA
- Rewrites each section header so `PointerToRawData == VirtualAddress` and `SizeOfRawData` covers the section
- Leaves DOS/NT/optional headers byte-for-byte intact, so `ImageBase`, `SizeOfImage`, the relocation directory and the import directory keep their true values
- Skips the synthetic `tdb` block

Recovered file: 10,530,816 bytes, 10,507,204 live bytes, image base `0x10000000`, 8 sections, `.reloc` at RVA `0x9f1000` (103,644 bytes), `.import` at RVA `0x2b38bc` (400 bytes). Source analysis MD5 `467dc3018eb91b48b8031813559ed3bc`.

Two Ghidra Java compile errors hit on the way, both fixed at the cause: `MemoryBlock.getBytes` takes a `long` size, and no `byte[]` overload exists on `MemoryBlock`. The fix reads through `Memory.getBytes(addr, byte[] dest, int off, int len)`.

Companion diagnostic `ListPrograms.java` prints program metadata and blocks.

### Verification is through the real consumers, not by eyeballing bytes

```bash
bun -e "..." # probe: IATResolver.loadFromBuffer(pe, 0x13000000) -> 359 IAT entries
              # rebaseCfg(cfg_xlive59.json, pe, 0x13000000) -> 9964 functions,
              #   imageBase 0x10000000 -> 0x13000000, first entry xlive_dll_AOT_recovered_10001000 @ 0x13001000
```

Both walk the reconstructed HIGHLOW records and data directories for real. A subtly corrupt PE would have thrown in either.

## 3. Build 92 (the first build to include the flag-transfer fix)

`dist-recompile.cjs` is a prebundled esbuild artifact and was **stale**, so the rebundle was mandatory:

```bash
./node_modules/.bin/esbuild tools/recompile-native-cfg.ts --bundle --platform=node \
  --format=cjs --outfile=dist-recompile.cjs --log-level=error
node --max-old-space-size=8192 dist-recompile.cjs ../halo2-browser/scratch/ghidra/native-build92.json
```

```
d3dx9_43.dll: 4674 functions, loaded base 0x13a10000
xlive.dll:    9964 functions, loaded base 0x13000000
pccompat.dll: 1634 functions, loaded base 0x13c10000
d3dx9_31.dll: 5810 functions, loaded base 0x13c70000
Validated 38757 functions, 133547660 bytes        # exit 0
```

Deployed to `public/halo2_recompiled.wasm`, `cmp` byte-identical. **+8,448,444 bytes vs Build 91** — that growth is the CF/PF/ZF/SF/OF globals and cross-CALL flag transfer entering the binary for the first time. Build 91 was 125,099,216 bytes.

## 4. Live Chrome boot — the important new evidence

Chrome is launched by the harness itself over CDP on port **9333** (`DEFAULT_CDP_PORT` in `tools/cdp-core.ts`; profile `tmp/cdp-profile`), not 9222. Vite must be up on 5174.

```bash
timeout 180 bun tools/boot-halo2.ts        # exit 0
sleep 45
timeout 90 bun tools/read-chrome-logs.ts > tmp/logs.txt 2>&1   # exit 124 expected, it long-polls
```

Boot log, in order:

```
VirtualAlloc(lpAddr=0x0, size=4096, type=0x1000, prot=0x40)
VirtualAlloc: Committed 4096 bytes at 0x1970000 perms=rwx
VirtualAlloc -> 0x1970000 (size=4096)
[AOT unresolved] target=0x1970421 esp=0x12ffb90 return=0x408f4a
[Recompiler] Last debug block: 0x6875db ESP=0x12ffab8 EBP=0x12ffb64
[Recompiler] Fatal execution error: AOT unresolved indirect call: 0x1970421
```

**The stop is unchanged, and that is the result.** `0x1970421` is at page offset `0x421` inside the 4 KB page allocated two log lines earlier. Build 92 therefore confirms NEWEST-92's mechanism from our own boot rather than from a disk dump, and it confirms the flag-transfer work was a real prerequisite but not the blocker.

It also means the remaining gap is now **architectural and singular**: the lifter cannot reach code the CPU generates at runtime. There is no function entry for that page in any image, so no amount of Ghidra recovery reaches it and `[AOT unresolved indirect call]` will always fire.

## 5. Next step: native decode of the runtime page

Per `CHECKPOINT-92.md`, whose forensics still hold:

- Live page at `0x1970000` is 4096 bytes; **4063 match EXE page `0x661e28`**; patched regions are offsets `0x421..0x435` (21 bytes), `0xac3..0xac9` (7), `0xcd8..0xcdc` (5).
- At `0x421` the rewritten bytes are `PUSH ESI; MOV ESI,[ESP+8]; TEST ESI,ESI; CALL 0x78fccb`. The first seven bytes coincidentally match EXE `0x453210` — that is what NEWEST-91 misread as the source.
- `0x1970421` maps to source `0x662249`, inside `FUN_00662215`, and the bytes **differ** at the patch. Dispatching to that static function runs different code.
- The companion hook `0x78fccb` calls `FUN_00423b32`, which reads the saved flags and return slot to pick its next branch. Do not skip it.

Plan: decode the reachable patched bytes from live guest memory with iced-x86, execute them against real register/flag state, then transfer to the compiled hook. **Do this in a synthetic test first**, proving a decoded prefix and a faithful hook transition, before running Chrome.

Two facts that help and were not in the earlier checkpoints:

- iced-x86 JS/WASM decoding already works — it decoded this exact prefix correctly in a private spike — but **no decoder dependency was added to the repo**. That is still true.
- The flag globals just built (CF/PF/ZF/SF/OF backed by WASM globals, saved/restored across CALL) are precisely the cross-boundary state this interpreter needs. `0x78fccb` reads the flags the caller's `TEST ESI,ESI` left behind, so without that work the hook could not branch correctly.

The bytes may already be resident in guest memory, since `VirtualAlloc` returned `rwx` and the copy ran. That would be a better decoder input than a disk dump — **but it has not been dumped or measured yet, so treat it as an untested hypothesis.**

A blind v86 fallback is not available: the v86 CPU is stopped before its protected-mode bootloader runs. This is AOT-only.

## 6. Tests and typecheck

```
bun test tools/tests      -> 1094 pass / 0 fail, 5467 assertions, 130 files   (exit 0)
node node_modules/tsgo/bin/tsc -p tsconfig.json --noEmit -> exit 0, no output
```

The flag-transfer test in `tools/tests/recompiler-bbt-return.test.ts` was verified **non-vacuous**: with the lifter change reverted it fails `Expected: 68, Received: 0` (exactly the PF and ZF bits), and passes once restored.

## Gotchas that persist

- **One `-postScript` per analyzeHeadless call.** Two in one call makes the first parse the second as a hex arg → `NumberFormatException`, *after* the recovery succeeded.
- For a script not on the default path, pass **`-scriptPath <dir>`** as well, or Ghidra reports it cannot find the script. A missing class then shows as `ClassNotFoundException`, which reads like a compile failure rather than a path problem.
- `tools/read-chrome-logs.ts` never exits; always wrap in `timeout`.
- Ghidra project must be opened with the **absolute path**, and the project dir must pre-exist.
- Python `open()` needs Windows paths — use relative paths from repo root, not bash `/c/...`.
- `git diff --numstat` distinguishes real edits from EOL-only noise.
- `halo2.exe` image base is `0x400000`, so RVAs must be rebased or every lookup reports "NO FUNCTION CONTAINS THIS ADDRESS".

## Rules

- The guest call site in disassembly is the authority for HLE arity, not the vendor header. Wrong arity silently over-pops and surfaces much later as an unrelated `0xC0000409`.
- Do not weaken or stub the security check. Cookie global `0x868b38`, `__security_check_cookie` at `0x6875d3`.
- Never fake API success; prefer an accurate generic Windows API over fabricated metadata.
- Keep bundles, assets, logs, saves, page dumps, WASM and `bun.lock` out of Git.
- Multiple agents share this checkout: inspect `git status` and branch before staging, never `git add -A`.

## Cleanup performed

The harness Chrome (PID 31200, verified by command line as `--user-data-dir=tmp/cdp-profile`) was killed; port 9333 released; the user's own Chrome (13 processes) was left running; Vite left up on 5174.