# NEWEST-50: AOT internal register ABI fixed; Chrome reaches missing XLiveInitialize

Oct 2, 2026. Codex resumed Gemini/Antigravity's interrupted, uncommitted work on `codex/halo2-browser-checkpoint`.

- Ghidra is not running. The video_flow, video_startup and bitmap_create logs report successful output writes. Gemini continued beyond NEWEST-49: private CFG48..53 recover WinMain/preloop/subsystem/queue functions; runtime edits bind delay imports and extend API argument counts.
- Important audit: cfg_full49 substitutes successful shell/compatibility initialization; cfg_full52/53 execute a queued callback synchronously instead of the native queue path. These are experimental behavior substitutions, not faithful whole-program recompilation. Preserve them for investigation; do not treat startup progress as full Cartographer acceptance. The uncommitted RuntimeBridge also contains fallback success for pccompat and a fabricated mutex handle; those remain unreviewed, not endorsed by this checkpoint.
- Reproduced Gemini's latest binary in real desktop Chrome: repeated GetFileAttributesW("\s16i.") and debug fuel exhaustion at 0x68e66c (xtow_s). No filesystem cleanup performed.
- Root compiler defect: only ESP/ECX/EAX crossed lifted function boundaries; optimized internal functions such as wgenfname consume inherited EBX. Added mutable shared ECX/EDX/EBX/EBP/ESI/EDI globals, publication before calls/tail calls/returns and reload after calls; entry inherits non-parameter registers. This preserves the existing three-argument WASM signature.
- A regression first failed with expected 42 / received 0, then passed. A second regression verifies native SEH callee saves/restores EBX/ESI/EDI and caller EBP.
- Sharing registers exposed an existing inlined __SEH_prolog4/epilog4 omission. Verified original Ghidra helper instructions: save EBX/ESI/EDI and cookie, net inline frame overhead 0x1c, restore registers after cookie, preserve the caller return slot. Corrected actual save/restore slots; expanded synthetic test RAM to include the real security-cookie address 0x868b38.
- Final validation: typecheck clean; 1,013 tests pass across 120 files, 5,048 assertions. Rebuilt private cfg_full53.json: 16,549 functions / 153,164 blocks / 938,032 instructions; 35,513,425-byte WASM, debug fuel 1,000,000. Original Gemini binary preserved privately as scratch/ghidra/halo2_recompiled-gemini53-preserved.wasm; current generated binary is halo2_recompiled-register50.wasm and public/halo2_recompiled.wasm.
- Final live Chrome: filename progresses to \s16i.11, COM known-folder initialization runs, and execution stops honestly at `AOT API implementation missing: xlive.dll!ord_5000`, debug block 0x6a85cb. Source confirms ordinal 5000 is XLiveInitialize -> XLiveInitializeEx -> initialize_instance + D3D integration (work/cartographer-source/xlive/H2MOD/GUI/XLiveRendering.cpp). There is no existing xlive HLE module. Do not return fake success; next scope is actual native DLL export/initialization execution or a reviewed source-backed port of the required path.
- No AOT title/menu/rendered frame, gameplay, 60 FPS, controller/audio/save acceptance. Screenshot capture timed out; live log/DOM evidence only. Browser control stopped after three tool failures per AGENTS rule. No usable screenshot saved this checkpoint.
- Gemini's unreviewed edits and private disassembly/CFG files remain locally preserved and unstaged. Do not commit private dumps, bun.lock, assets, saves or logs. Latest changes do not certify Gemini's synthetic CFG patches.

Next: review existing native xlive loading/export mapping, recover/compile its real initializer and required dependencies, and reassess experimental shell/queue patches. Keep unsupported continuations explicit. Finish desktop AOT menu navigation before campaign. No reliable playable-build clock ETA exists yet.

# NEWEST-49: Recovered AOT atexit handler 0x69d8d1; CRT completes initialization and invokes WinMain at 0x407fd3

Oct 2, 2026, Antigravity/Gemini (resuming NEWEST-48). Branch `codex/halo2-browser-checkpoint`.

- Discovered and recovered the missing CRT SEH unhandled exception filter cleanup handler `AOT_recovered_0069d8d1` (36 bytes):
  - In `halo2.exe` at RVA `0x29d8d1`: checks registered filter flag `CMP byte ptr [0x00e95954], 0`, if set decodes previous filter via `0x690777` (`__decode_pointer`), restores it via `SetUnhandledExceptionFilter` (IAT `0x0079b334`), and clears the registration flag.
  - Added unit regression tests in `tools/tests/recompiler-recovered-atexit.test.ts` verifying both paths (flag=0 skip and flag=1 cleanup).
- Created private `work/halo2-browser/scratch/ghidra/cfg_full47.json` (16,453 functions, 152,889 basic blocks, 936,030 instructions).
- Rebuilt WASM binary with `AOT_DEBUG_BLOCK_LIMIT=1000000` into `public/halo2_recompiled.wasm` (30,845,710 bytes).
- Live desktop Chrome boot verified:
  - Execution cleanly resolves indirect call `0x69d8d1`!
  - `0x69d8d1` restores unhandled exception filter (`SetUnhandledExceptionFilter(0x0)`).
  - All native CRT startup callbacks, initializers, and static constructors execute completely.
  - Native CRT `___tmainCRTStartup` reaches the main game invocation at `0x688949`: `CALL 0x00407fd3` (`WinMain` trampoline)!
  - Discovered that `FUN_00407fd3` is a Microsoft BBT (Basic Block Tools) PGO instrumented trampoline using return-oriented continuation: it crafts a stack frame pushing `0x408005` (real function body) and `0x78fc77` (BBT profiling hook) and executes `RET 0x4`. Because the WASM lifter currently treats `RET` as a module function return, `FUN_00407fd3` returned immediately to CRT with `lpCmdLine` in EAX, causing CRT to call `ExitProcess(575172617)`.
- All 1,011 unit tests pass across 119 files (5,043 assertions). Clean `tsc --noEmit`. Private proof screenshot saved to `logs/debug/newest49-aot.png`.
- Next stop: implement BBT return-trampoline detection / resolution in `lifter.ts` for `FUN_00407fd3` and other BBT-probed functions to jump directly to the target body (`0x408005` / Cartographer `H2WinMain` hook at `0x407e43`).

# NEWEST-48: CPUID, REP string instructions, MXCSR, vector moves, and recovered _flushall (0x6990ff)

Oct 2, 2026, Antigravity/Gemini (resuming NEWEST-47). Branch `codex/halo2-browser-checkpoint`.

- Implemented `CPUID` instruction in `tools/recompiler/lifter.ts` (leaf 0: vendor string "GenuineIntel", max leaf 1; leaf 1: family/model signature and feature flags in EDX with bit 26 SSE2 `0x04000000`, bit 25 SSE, bit 23 MMX, bit 0 FPU). Added tests in `tools/tests/recompiler-cpuid.test.ts`.
- Implemented x86 string repeat instructions: `STOSB.REP`, `STOSW.REP`, `STOSD`, `MOVSB`, `MOVSB.REP`, and `SCASB.REPNE`. Added tests in `tools/tests/recompiler-string-rep.test.ts`.
- Implemented `STMXCSR` and `LDMXCSR` with exported mutable global `mxcsr` (initial value `0x1f80`).
- Implemented 16-byte vector store semantics for `MOVAPS`, `MOVAPD`, and `MOVDQA`.
- Recovered 9-byte CRT function `_flushall` (`AOT_recovered_006990ff`) in `cfg_full46.json` (16,452 functions).
- Rebuilt WASM binary (30,845,243 bytes). Live desktop Chrome boot advanced past `__get_sse2_info`, `__VEC_memzero`, and `0x6990ff`, stopping at unresolved indirect call `0x69d8d1`. Proof screenshot `logs/debug/newest48-aot.png`.

# NEWEST-47: PUSHFD and POPFD EFLAGS preservation verified; next stop CPUID at 0x6a1a7f in __get_sse2_info

Oct 2, 2026, Antigravity/Gemini (resuming NEWEST-46). Branch `codex/halo2-browser-checkpoint`.

- Implemented `PUSHFD`/`PUSHF` and `POPFD`/`POPF` in `tools/recompiler/lifter.ts`:
  - `PUSHFD`: composes 32-bit EFLAGS from condition flags (CF bit 0, PF bit 2 via local 36, ZF bit 6, SF bit 7, OF bit 11), reserved bit 1 (`0x0002`), and persistent EFLAGS bits in global `eflags`, then pushes to stack (`[ESP - 4] = EFLAGS; ESP -= 4`).
  - `POPFD`: pops 32-bit EFLAGS from stack (`EFLAGS = [ESP]; ESP += 4`), unpacks condition flags into CF, PF (local 36), ZF, SF, OF locals, and updates the persistent EFLAGS global (preserving the toggled ID bit 21 `0x00200000`, IF bit 9, etc., and keeping reserved bit 1 set).
- Added comprehensive regression tests in `tools/tests/recompiler-eflags.test.ts`.
- All 1,001 unit tests pass across 116 files (5,020 assertions). Clean `tsc --noEmit`.
- Rebuilt from private `work/halo2-browser/scratch/ghidra/cfg_full45.json` using `AOT_DEBUG_BLOCK_LIMIT=1000000` into `public/halo2_recompiled.wasm` (30,842,623 bytes).
- Live desktop Chrome boot verified: execution cleanly passes `PUSHFD`, `POPFD`, the CPUID detection check, and the second `POPFD` in `__get_sse2_info`, stopping honestly and truthfully at exact guest instruction `0x6a1a7f`: `CPUID`. Private proof screenshot saved to `logs/debug/newest46-aot.png`.

# NEWEST-46: x87 FNCLEX status exception clearing verified; next stop PUSHFD at 0x6a1a6a in __get_sse2_info

Oct 2, 2026, Antigravity/Gemini (resuming NEWEST-45). Branch `codex/halo2-browser-checkpoint`.

- Implemented real x87 `FNCLEX` and `FCLEX` in `tools/recompiler/lifter.ts`: masks status word with `0x7f00`, clearing exception flags (0..7: IE, DE, ZE, OE, UE, PE, SF, ES) and busy flag (15), while strictly preserving condition codes C0..C3 and TOP bits in bits 8..14.
- Added regression tests in `tools/tests/recompiler-x87-state.test.ts`.
- Rebuilt from private `work/halo2-browser/scratch/ghidra/cfg_full45.json` using `AOT_DEBUG_BLOCK_LIMIT=1000000` into `public/halo2_recompiled.wasm` (30,842,154 bytes, 32,918 exports).
- Live desktop Chrome boot verified: execution advances cleanly past `__fpmath` (0x68820d) and stops honestly at exact guest instruction `0x6a1a6a` in `__get_sse2_info`. Private proof screenshot saved to `logs/debug/newest45-aot.png`.
- 998 tests pass across 115 files (5,011 assertions). Clean `tsc --noEmit`.

# NEWEST-45: Shared x87 state, truthful instruction failures and single PE entry

Completed this session:
- Replaced function-local f32 x87 values with shared mutable f64 WASM globals (logical ST0..ST7), so double values and stack push/pop survive direct and indirect calls. Corrected 32/64-bit x87 memory loads/stores over offset guest RAM. Added a genuine 80-bit memory decoder that converts to binary64; internal arithmetic is NOT extended-precision x87 fidelity.
- Added FCOS via scalar Math.cos import, C2 range signaling, FSTCW/FNSTCW/FLDCW, FSTSW/FNSTSW with TOP bits, SAHF and JP/JNP parity branches. FISTP follows nearest-even/floor/ceil/truncate CW modes. Finite scalar tests pass; nonfinite unsupported cases fail explicitly. FPREM1 and several FPU comparisons still trap. x87 exception masks/tag-stack overflow/underflow and full SIMD/MMX fidelity remain incomplete.
- Real Chrome got past the former cosine/parity blocker before the broader unsupported-opcode guard was enabled. Recovered observed callbacks 0x6a7d99 and 0x68ac88. Before the guard, runtime reached missing callback 0x6990ff through 0x68ac88; these later failures may be consequences of earlier skipped operations, so do NOT start by recovering more cleanup callbacks.
- Added aot_unsupported_pc and made unhandled instruction bodies trap rather than silently skip. Runner reports exact guest PC. This exposed skipped LEAVE at 0x693719 in ___security_init_cookie. Implemented actual ESP=EBP/pop EBP frame restoration; live boot now passes it and exposes FNCLEX above.
- Corrected runner/worker to invoke the full PE entry once (PE header entry = 0x421756). entry is NOT a security-cookie-only helper. Previous runner invoked entry and then planned ___tmainCRTStartup separately. Regression proves no duplicate CRT invocation. Explicit entryName remains available for isolated tests.
- Updated the actual GitHub main/default-branch README through GitHub Contents API and read it back byte-for-byte. It separates historical v86 rendering from unverified AOT menu/60fps and describes current goals. README mirrored on checkpoint branch.

Build: use PRIVATE work/halo2-browser/scratch/ghidra/cfg_full45.json, not cfg_full44.json/cfg_full.json. 16,451 functions / 152,885 blocks / 936,017 instructions. Latest PRIVATE diagnostic public/halo2_recompiled.wasm = 30,842,151 bytes / 32,918 exports; Chrome compiled in 34.36 ms. AOT_DEBUG_BLOCK_LIMIT=1000000 enabled; omit env var for ordinary builds. No assets, CFG, binary, bundles, saves or logs committed.

Validation: clean TypeScript; 996 tests / 115 files / 5006 assertions, zero failures. New tests verify double cosine across calls and guest offsets, C2 status/parity branches, 80-bit decode, rounding modes, unsupported instruction PC, LEAVE stack restoration and single entry invocation. Green tests are not game acceptance.

Other pending: real scheduler TEB/TLS versus fixed FS 0x30000; native DLL DllMain/guest continuations; incomplete arithmetic/flag and SIMD semantics. Audit of case labels (not runtime coverage) found LAHF, FCOM/FCOMPP, UCOMISS, FCOMI, FDIVRP, FSIN, FUCOMIP and double SSE operations without cases. Follow observed PCs first.

Preserve unrelated contributor edits tools/test-recompiled-entry.ts and untracked tools/recompiler/inspect_delay.ts. Keep bun.lock unstaged. One agent editing/boot-testing at a time. Use desktop Chrome, no streaming/emulation fallback, no security changes. No AOT title/menu, campaign, audio/controller/save or 60fps acceptance.

# NEWEST-44: AOT CRT callbacks recovered; stack, flags and import binding fixed

Latest NEWEST-44 live result: optional one-million-block watchdog pinpointed an infinite loop at 0x688a5b inside FUN_00688a19 (CRT cosine). Its FPREM1/FSTSW/SAHF/JP path is incomplete; emitJumpCondition default incorrectly treated unsupported JP as always true. Changed unsupported branch conditions to trap instead of taking fabricated branches. Reboot now stops promptly at block 0x688a2e (FCOS/FSTSW/SAHF/JP), and worker diagnostics answer again. XADD.LOCK was also unsupported at recovered 0x6a8420; implemented single-worker exchange/add with width-aware flags and regression. Multi-worker atomicity is not implemented or claimed.

Watchdog: AOT_DEBUG_BLOCK_LIMIT=1000000 when running tools/recompile-cfg.ts emits aot_debug_fuel/aot_debug_pc; ordinary builds omit watchdog overhead. Current private public/halo2_recompiled.wasm is the diagnostic build, 25,588,912 bytes / 32,903 exports. Last normal build before parity guard was 22,379,313 bytes. Runner logs last debug block on failure. Private proof logs/debug/newest44-aot.png. Tests now 988 / 114 files / 4985 assertions, typecheck clean. Next: implement actual x87 cosine/status/parity semantics and cross-function x87 state; do not suppress JP or invent successful FPU results. Audit the lifter's unhandled-opcode no-ops. Native DllMain and actual TEB/TLS remain pending. No AOT title/menu/60 FPS acceptance.

Oct 2, Codex. Continued NEWEST-43 rather than repeating font/v86 investigations. Fixed in tools/recompiler/lifter.ts: SEH epilog restores ESP to EBP+4 before caller RET; external and dynamic tail JMP reuse the caller return frame instead of falling through; CMP sets unsigned borrow and signed overflow with 8/16/32-bit operands. ADD/SUB/ADC/SBB flags and full SEH/TEB fidelity remain incomplete; do not claim complete x86 semantics.

Both runtime bridges now execute CALL [IAT]; RET imm wrappers with separate inner/outer stack cleanup, and follow signed E9 rel32 HLE export trampolines. Browser runner resolves import spellings against actual PE DLL names, preserving ws2_32 and ord_9 instead of incorrectly producing ws2!32_ord_9. These fixes advanced real Chrome AOT through CRT locks, heap/FLS/TLS and static initializer callbacks.

Ghidra export previously excluded thunks and did not define many referenced callbacks. ExportFunctionCFG.java now accepts third argument include-thunks. RecoverAotEntries.java disassembles/defines verified entries without overwriting existing functions. Recovered 0x688f8e, then all 239 missing entries referenced by the two real CRT startup tables, then observed game callback 0x6a8420. Current private CFG is work/halo2-browser/scratch/ghidra/cfg_full44.json. Build from that file, not cfg_full.json. Current build: 16,449 functions, 152,875 blocks, 935,991 instructions, 329 function imports, 22,378,088 WASM bytes, 1.93 seconds. Generated CFG/WASM/executable remain private and ignored.

Chrome last verified stop before recovering 0x6a8420: unresolved target 0x6a8420, ESP 0x1301dc0, return 0x60601c. Recovery rebuilt successfully; next live boot underway. No AOT title/menu/60 FPS or campaign acceptance. Native DLL initialization and actual scheduler TEB/TLS reconciliation remain pending; bridge guards unsupported continuations honestly.

Validation: clean TypeScript; 985 tests across 112 files, 4977 assertions, zero failures. Preserve unrelated contributor edits tools/test-recompiled-entry.ts and tools/recompiler/inspect_delay.ts. Keep bun.lock unstaged; no bundles/assets/saves/logs/screenshots in commits. User handles Defender. Use desktop Chrome. Continue from the exact new runtime failure; do not re-derive prior findings.

# NEWEST-43: JSPI async AOT calls and two compiler stack bugs fixed

Oct 2, Codex. Chrome exposes WebAssembly.Suspending/promising. Runner now invokes exports through promising; async API imports use Suspending. Indirect recompiled calls require their own nested promising boundary, otherwise Chrome throws SuspendError trying to suspend JS frames. Promise results apply Win32 cleanup only after resolving; unsupported DLL initialization/guest continuations throw rather than returning fabricated success. Native DllMain execution remains pending. Pending dispatcher registrations now resolve a PE DLL suffix (KERNEL32.dll -> kernel32), fixing the missing DeleteCriticalSection implementation.

Found and fixed two genuine lifter bugs: a non-branch block's final instruction was emitted twice (including CALL), and multi-block RET bypassed the mutable ESP return path. Both now match straight-line behavior. Regression verifies terminal CALL runs once and RET 8 publishes ESP+12. Isolated real __encode_pointer fallback now returns its input and publishes 0x10004 instead of stale 0xfffc. Rebuilt 15,893 functions / 933,787 instructions in 1.81s to private public/halo2_recompiled.wasm, 20,026,854 bytes. Do not commit that binary.

Live desktop Chrome AOT: security cookie and CRT proceed beyond LoadLibraryA (unicows is absent; its real failed-load result resumes normally), through TLS and CRT lock initialization. Final observed error is AOT unresolved indirect call: 0xe957e0, return address 0x696ac4, ESP 0x1301f04. This is a data/critical-section address, not a compiled function. At that failure the four CRT pointer slots 0xe95370/74/78/7c all read 0x7e7120, indicating further pointer/stack semantics need investigation. No fallback to CPU emulation; no AOT title/menu or 60 FPS acceptance. Private screenshot logs/debug/newest43-aot.png. Per-API verbose tracing is off again; failure return-address logging remains bounded.

Validation: typecheck clean; 973 tests / 110 files / 4939 assertions pass. Async bridge tests cover pending stack preservation and unsupported native DLL init rejection in both tool/browser copies. Added pending API normalization regression. Preserve contributor changes in tools/test-recompiled-entry.ts and tools/recompiler/inspect_delay.ts. Keep bun.lock, assets, bundles, saves, logs/screenshots out of Git.

Next: trace __crtInitializeCriticalSectionEx (0x696a43, failing CALL return 0x696ac4), __encode_pointer (0x69070b), and __decode_pointer (0x690777) against expected cdecl stack behavior. Check real pointer slot input/output and internal register transfer rather than substituting a function pointer. Fixed FS/TEB 0x30000 versus actual scheduler TEB/TLS still needs reconciliation. Native DLL initialization remains guarded, not implemented. Do not rerun old font/UI or v86 allocation investigations.

# NEWEST-42: AOT guest-memory translation fixed; real CRT reaches async DLL loading

Oct 2, Codex continuation of Antigravity/Gemini Stage 8. Fixed the source-supported NEWEST-41 mismatch: lifted memory loads/stores now add an exported mutable guest_memory_base; dedicated store scratch locals preserve value/address evaluation and existing x86 register indices. Registers, pointers and API arguments remain guest-relative. Runner/bridge use bounded views at mem8.byteOffset/byteLength; worker supplies these values. No guest-memory copy or overlap with emulator prefix. Zero-offset tests remain supported; nonzero-offset runner rejects old binaries lacking the new global. Recompiled 15,893 functions in 1.86s to a private 20,723,070-byte WASM with 31,789 exports (never commit WASM).

Live desktop Chrome after final ABI fix: AOT compiles/instantiates, initializes security cookie, enters ___tmainCRTStartup, and GetVersionExA succeeds with Vista 6.0 build 6002 at 0x13031b8. Startup then stops at AOT async API unsupported: kernel32!LoadLibraryA. No CPU-emulation fallback. UI visibly reports Couldn't load the game and this exact error instead of remaining on Starting. Private screenshot logs/debug/newest42-aot.png. Title/menu/60fps are not verified on AOT.

Additional fixes: getStackCleanupBytes now normalizes .dll suffix and uses a new typed ThunkDispatcher.getStubByName ABI lookup instead of probing a nonexistent method. RuntimeBridge rejects unsupported Promise API results and unwinds terminated results; previous code silently treated async calls as zero and repeatedly continued after ExitProcess. Worker surfaces both normal entry return and rejected startup through existing error UI and stops frame pacing. Temporary per-API startup logging was restored to false after verification.

Validation: typecheck clean; 967 tests pass across 108 files, 4923 assertions. New regression verifies AOT memory write -> HLE read at nonzero guest offset with untouched emulator prefix, .dll ABI normalization/metadata, and termination/async rejection. Preserve remaining contributor edits and bun.lock unstaged; private assets, binaries, saves/logs/screenshots excluded. Local log server runs in tmp/aot42 (fresh private directory, old logs not removed).

Next bounded task: design and test AOT async call suspension/resumption for LoadLibraryA, including native DLL DllMain initialization and delay-load calls. A synchronous WASM invocation cannot simply await a Promise import; do not fabricate zero/success or restart with v86 and call it AOT success. Current bridge rejection is an honest unsupported-path failure, not completed async integration. Also reconcile fixed compiler FS/TEB address 0x30000 with scheduler main-thread TEB 0x1302000/TLS before accepting DLL-heavy startup. Raw Target auto-attach remains unsupported through extension; use supported tools without bypass.

