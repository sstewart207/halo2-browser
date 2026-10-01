# Halo 2 browser checkpoint - 2026-09-30 (paused)

Paused at the user's request with 3% usage remaining. Native game code executes locally in Chrome, but no Halo menu/video/gameplay is verified. Preserve all game files and logs outside Git; native Windows install and Defender settings are unchanged.

## Latest verified progress

- `def977e` fixed the CRT trap by allocating page tables outside Halo's PE image. `0xe7618007` was a page-table entry written over an API pointer. Older resolver/decryption hypotheses below are superseded.
- Registry root canonicalization makes HKCR registrations visible to COM activation.
- A private trial uses the already-installed native msxml3.dll and msxml3r.dll. Explicit API-set aliases/import signatures, real semaphore/mutex APIs, UTF-16 wcsrchr, safe memcpy_s, FindResourceExW, and mapped LoadResource data advanced MSXML initialization.
- Chrome executes native DllMain, DllGetClassObject and IClassFactory::CreateInstance. DOMDocument30 / IXMLDOMDocument creation returns S_OK.
- Next observed failure is the unimplemented ResolveDelayLoadedAPI thunk at native msxml3.dll+0x6b5f5; crash handling subsequently exits C0000409. NtQuerySystemInformation and other API gaps remain.

## Resume first

A new ResolveDelayLoadedAPI implementation and PE32 delay-import decoder are saved. It handles names/ordinals, RVA/legacy-VA descriptors, LoadLibrary/GetProcAddress, IAT patching, and deferred native DLL initialization/failure hooks. **It passes TypeScript and parser tests, but its native Chrome integration has not been tested.** Do that first; do not claim it solved startup yet.

Fresh Chrome reload, set `window.__BS__.harness.logBufferSize(20000)` before boot, then open the private `halo2-msxml-res.wgb` trial. Check live stubs, logs and UI. Source changes can reload into an empty worker. Default diagnostics retain only 50 lines. Campaign maps are not in the trial.

Validation: **39 tests pass / 268 assertions**, TypeScript clean, actual installed executable version test ran read-only. Last Chrome verification includes memcpy_s and CreateMutexExW, but precedes the new delay resolver. No production build performed. Some supplementary API entries are ABI definitions only, and the CRT invalid-parameter handler remains limited.

Always pass `--repo sstewart207/halo2-browser` to gh; its inferred repository may be the public upstream. Preserve unrelated bun.lock/generated/index changes. Parent AGENTS.md and HANDOFF.md hold full setup and pause instructions. Resume only when the user asks.

---

# Earlier checkpoint evidence (superseded where noted above)

## Status

Project Cartographer executes locally in Chrome, but Halo 2 still crashes before its menu. No campaign, graphics, audio, controller or save-state acceptance yet. Multiplayer is deferred. Game assets and runtime logs stay outside this Git checkpoint.

## Preserved work

- Real PE RT_VERSION extraction and version.dll queries; installed halo2.exe reports OriginalFilename=halo2.exe and ProductVersion=1.00.00.11122. Removes fabricated NFS metadata.
- Mapped synthetic PE export images for HLE DLL handles, including executable JMP trampolines to real API thunks.
- PE layout correction: trampolines are outside the export data-directory range, which is reserved for forwarder strings. Export name pointers use case-sensitive ASCII ordering.
- Offline IP Helper APIs, supplemental x86 import ABI definitions, explicit unsupported DPAPI failures, PE-load failure propagation.
- Responsive diagnostics and recent-log loading. Narrow Chrome verified at 100%, 110%, 125%, 150% zoom in earlier session.
- Crash reports now collect small bounded memory samples at CPU register addresses and recent return sites, including absolute JMP pointer slots. Typechecked; browser display verification remains pending.

ABI descriptors do not implement the corresponding APIs. Unknown generic stubs can still return inappropriate success-shaped values.

## Validation

TypeScript passes. Targeted tests: 24 pass, 0 fail, 155 assertions across version-resource, hle-image, import-supplement and iphlpapi-offline. The installed-executable resource test ran, rather than skipping.

Chrome reproduced EIP 0xe7618007 after the PE layout fix. The fix addresses a verified format defect; it did not resolve the current trap.

## Current crash evidence

Expanded live Chrome report:
- EIP=0xe7618007; EAX=ESI=0x41302f; EDI=0x13d70000.
- ESP=0x1301f4c; top stack words: 0x690ae4, 0x13d70000, 0x7e7138.
- 0x7e7138 is the FlsAlloc string. 0x690ae2 calls ESI to resolve it.
- Original executable 0x41302f is a delayed GetProcAddress wrapper ending in JMP [0x86d7b4].
- Original executable 0x413189 walks PE exports and rejects targets inside the export data-directory range; 0x4130df uses a case-sensitive binary search.
- 0x69070b/0x690777 are EncodePointer/DecodePointer wrappers. Earlier notes that treated these directly as export walkers were imprecise.

The earlier xlive patch/decrypt hypothesis is unconfirmed. Do not treat previous claims that pointer encoding, stubs or resolver paths were ruled out as conclusive for this newer captured stack.

Next: fresh Chrome worker load with the memory samples; compare bytes at 0x41302f and JMP pointer [0x86d7b4] against the installed executable. Inspect startup self-modification and instruction-cache invalidation only when the live bytes justify it. FlushInstructionCache currently returns TRUE without invalidating translated CPU code; whether this causes this trap is not established.

## Local setup and boundaries

Work here: work/bottleship-research within the parent workspace. Parent HANDOFF.md holds historical setup. Native installation remains untouched. No Defender changes. Chrome is required for runtime verification; no shell browser automation or policy bypass.

Bun binary relative to checkout: ../toolchain/node_modules/@oven/bun-windows-x64/bin/bun.exe
Typecheck: Bun runs node_modules/tsgo/bin/tsc -p tsconfig.json --noEmit
Tests: Bun test tools/tests/version-resource.test.ts tools/tests/hle-image.test.ts tools/tests/import-supplement.test.ts tools/tests/iphlpapi-offline.test.ts

Local servers: Vite 127.0.0.1:5174; optional logs port 3001. Verify before reuse.
Boot bundle: ../halo2-browser/bundles/halo2-boot.wgb, 24 files, mainmenu map only. Campaign maps are not in the fixture.

Original OpenCode edits were backed up before subsequent review in the parent outputs/opencode-pickup-20260930-155457/source-snapshot.zip, with a tracked-changes.patch. Backup contains source and checkpoint docs, not game assets.

Browser automation ended during fresh reload because its automatic URL check could not confidently identify Chrome's current URL. Do not claim the new memory-sample output has been inspected yet.

## Credits

Project owner: Shane Stewart. Contributors credited at Shane's request: Shane Stewart, ChatGPT (Codex), Claude Opus 5.5, and MiMo 2.6 Flash. The preserved version-resource and HLE-image handoff was also developed in OpenCode using Muse Spark 1.3.
