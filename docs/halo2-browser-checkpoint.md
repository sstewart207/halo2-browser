# Latest verified checkpoint: graphics device and render textures work; native shader compilation is next

September 30, 2026, late evening. User explicitly resumed Claude's work. This section supersedes all older pause/startup instructions. Base was Claude's pushed ddf3567. No menu, game video, gameplay, audio, controls, saves or DualSense acceptance yet.

## Chrome-verified progress

1. Added bounded earliest-fault retention: `h.faults(8, {first:true})` keeps the first faults even when the crash reporter overwrites the recent ring. Default `h.faults(n)` still returns recent faults; reset clears both. This revealed Claude's original crash: thread 5, halo2.exe EIP 0x432af2, reading NULL+0x3c after WaitForSingleObject(0xffffffff). The later xlive+0x10b71 fault is the reporter, not the cause.
2. Root cause was Halo's Unicode loader probing ntdll!LdrUnloadDll. With the export absent it took its Windows 9x/unicows fallback and bound CreateSemaphoreW to a native ERROR_CALL_NOT_IMPLEMENTED stub. Added the real NT ABI/export. HLE DLLs are process-lifetime pinned; native DLL detach explicitly returns STATUS_NOT_IMPLEMENTED. Verified NT selector 0x873df8 changes to 1 and semaphore 0x87eea8 becomes valid 0x30064. The helper crash disappears.
3. Next original failure was a NULL call from xlive+0x54a19: missing d3d9!Direct3DCreate9Ex. Added factory/device Ex descriptors with exact SDK slot order and cleanup, inherited implementations, real CreateDeviceEx, basic Ex presentation/reset/mode enumeration. Unimplemented Ex features explicitly return D3DERR_NOTAVAILABLE. D3D9 index is now CUSTOM so index generation does not erase the inheritance binding.
4. Chrome creates an actual 800x600 WebGPU D3D9 device and loads Halo's precompiled pixel shaders. Added standalone CreateRenderTarget via a real backend render texture and surface. Single-sample/non-lockable/unshared only; unsupported modes fail explicitly. Chrome allocates the primary render target plus dozens of render textures. No fabricated shader or substituted game frames.
5. Added exact per-bundle `emulator.nativeDlls` preference through import resolution and dynamic library loading. The installed 32-bit Microsoft d3dx9_31.dll executes inside the guest, not on a server. Added required CRT hyperbolic x87 intrinsics and _fpclass; native D3DX GDI font imports have correct signatures and explicit unsupported failures (font shaping is not implemented).

## Current blocker and next work

The native D3DX compiler returns D3DERR_INVALIDCALL (0x8876086c) for Halo's white shader. Halo logs `failed to initialize rasterizer` and exits via ExitProcess(0), with no faults in the earliest recorder. Import slot 0x79b544 points to native D3DXCompileShader (observed 0x13e3b324, DLL base 0x13d60000), so this is NOT the old HLE compiler stub.

Actual call: halo2.exe 0x65fa4c -> import wrapper 0x6a8559; source at 0x7dbea8 is `float4 main() : COLOR { return float4(1.0f, 1.0f, 0.0f, 1.0f); }`, profile 0x7dbea0 `ps_2_0`, entrypoint 0x7dbe00 `main`, flags 0, source length computed by native code. Native compiler offsets: entry RVA db324; after preprocessing/source initialization db385; after compilation db3c2; before reading final HRESULT db44f. Trace these stages and validate live arguments/CRT behavior. A first attempt with h.breakOn(...,{continuous:true,pause:false}) yielded no breakHit events; do not claim the error's inner cause is known. SDK/compiler work is still unfinished. Do not replace compilation with hardcoded bytecode/fake success.

Old nested crash-reporter SEH recursion remains a fidelity issue but is no longer the current startup blocker. OPFS temp-file paths C:/s16i.* also report TypeMismatchError; preserve saves and diagnose rather than deleting browser storage. Multiplayer remains deferred.

## Exact local resume

Repo: work/bottleship-research, branch codex/halo2-browser-checkpoint. Vite 5174, local log server 3001. Supported Chrome browser 3, claimed user tab 1897424839; verify tab identity before reuse. After compaction call cua.rewriteDocumentation(). No shell browser automation or security changes.

Newest private fixture: work/halo2-browser/bundles/halo2-native-d3dx.wgb, 667282346 bytes. It extends halo2-maps.wgb (664867830 bytes) with the existing C:/Windows/SysWOW64/d3dx9_31.dll and nativeDlls=['d3dx9_31.dll']. Campaign fixture includes maps/shared.map, single_player_shared.map and 01a_tutorial.map. Native game install remains read-only.

Reload Chrome, set h.logBufferSize(20000), h.streamLogs(), then fire-and-forget h.openWgb('/__wgb/?path='+encodeURIComponent('C:/Users/sstew/Documents/Codex/2026-09-29/private-just-for-us-do-i/work/halo2-browser/bundles/halo2-native-d3dx.wgb')). USE FORWARD SLASHES in the CDP expression: backslash escaping caused a false HTTP 404. PCC's 2 warnings still appear, Run is enabled; confirm its screen before clicking. RPC work can be fire-and-forget into a window capture object, then read JSON.stringify later. Raw log stream can drop batches; earliest faults are independent.

Validation: TypeScript clean; 53 tests / 350 assertions / 16 files pass (the previous 12 checkpoint files plus fault-recorder, d3d9-ex, native-dll-config, crt-fpclass). Production Vite build passes (normal vendor externalization/chunk-size warnings). Actual installed halo2.exe version test ran read-only. Assets, bundles, logs and screenshots remain outside Git. Preserve unrelated bun.lock and generated/index line-ending edits. Existing private draft PR #7; always pass --repo sstewart207/halo2-browser to gh.

---

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
