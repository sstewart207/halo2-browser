# NEWEST-60: sldl native startup compiled; malformed initializer CFG isolated

October 3, 2026. Actual Chrome still completes D3DX and Cartographer xlive PROCESS_ATTACH. Added the exact private sldl_dll image to the native multi-image build; its DllMain now executes and creates a CRT critical section. No AOT menu/video/60fps acceptance.

- Ghidra analyzed the exact extracted sldl_dll.dll in existing project scratch/ghidra/proj/halo2. Preferred base 0x400000, runtime base 0x13c10000, entry preferred0x6a0a5a/runtime0x13eb0a5a. Initial CFG exported 3,265 functions.
- Recovered observed CRT initializer preferred0x69f641 and then all 19 unique nonzero targets in the native C/C++ initializer tables 0x401378..0x401384 and 0x401318..0x401374. Table extraction script tmp/extract-sldl60.py; private target list sldl-init-targets60.json. Ghidra RecoverAotEntries.java used for discovery.
- Two verified EB08 jump wrappers at 0x6a05c6/0x6a05e7 had overlapping offcut disassembly. RepairSldlInitializers.java clears only those analysis ranges, disassembles and creates functions; it does not patch DLL bytes. cfg_sldl60d.json now includes all 19 table entries (3,299 functions). Private logs tmp/recover-sldl60c.log includes a corrected earlier failure; tmp/repair-sldl60d.log records repair.
- Private native-build60.json / halo2-native60.wasm: cfg_full53 EXE + cfg_d3dx9_43_51d + cfg_xlive59 + cfg_sldl60d; 34,486 functions / 94,762,203 bytes. Copied to public/halo2_recompiled.wasm. Binaries/CFGs remain outside Git.
- CURRENT LIVE STOP: sldl _initterm callback hits block-budget watchdog at runtime0x13eb0416/preferred0x6a0416. The exported AOT_recovered_006a040b CFG ends after MOV [ESP],EAX with no successor. Ghidra InspectAotEntry.java confirms undefined bytes at 0x6a0419 followed by misaligned PUSH/IMUL, whereas original bytes begin LEA. This is incomplete disassembly, not a reason to raise the watchdog.
- NEXT: repair only verified initializer analysis around 0x6a040b..0x6a044d, inspect accurate instruction/edge/body and computed targets before re-export. Raw bytes show arithmetic LEA addressing and stack-based RET4 dispatch; lifter currently returns through WASM and ignores modified guest return PCs. A generic, tested return-jump/continuation dispatcher may be required. Do not silently skip constructors, substitute success or certify a repaired CFG as correct execution. Computed target/continuation must be confirmed from original bytes and relocation state.
- A preliminary modified-RET diagnostic guard was tested, failed six legacy synthetic fixtures (unmapped synthetic stacks or inconsistent API cleanup), and was fully reverted. No guard is in the build/commit. After reverting: 1,067 tests / 0 failures / 5,348 assertions, 126 files; typecheck clean. Full RET architecture needs meaningful valid-stack, continuation, register and async tests rather than forcing old fixtures green.
- Remaining later DLLs pccompat and d3dx9_31 are not yet compiled; actual TEB/TLS, native dynamic attach and guest threads remain pending. Experimental EXE shell-success/queue substitutions inherited from Gemini remain unvalidated. No AOT title/menu/video/campaign/audio/controller/saves/60fps acceptance.
- User requested continuing work with current agent handoffs. Root AGENTS.md/CODEX-HANDOFF.md/HANDOFF.md and repo docs updated. Keep bun.lock and unrelated Gemini edits unstaged. Only own private repo; do not merge PR7 or close issues. Chrome tab1897427854; Vite5174. Re-read this checkpoint before trying older v86 recipes.

# NEWEST-59: Cartographer xlive DllMain succeeds in actual Chrome

October 3, 2026. Major native milestone: real Cartographer xlive.dll PROCESS_ATTACH returns success, verified by the runner advancing to the next native DLL. D3DX attach also succeeds. This is native DLL startup acceptance, not AOT menu/video/campaign/60fps.

- Ghidra recovered observed constructor 0x10068b20 into private cfg_xlive59.json (9,964 functions). Added OR.LOCK for the current single guest-thread path after CRT file-stream allocation stopped at 0x131bd4e4. Neighbor writes/logic flags tested; multi-thread atomic ordering not certified.
- Native Cartographer progresses through display enumeration and map-file probing. Missing maps in this private bundle produce file-not-found; no asset download or filesystem cleanup performed.
- Actual next failure was missing CryptAcquireContextW. Added UTF-16 entry point sharing existing ANSI provider lifecycle; tested Unicode names, invalid output pointer and handle release. Preserve backend limitations: this does not implement complete Windows provider/key-container policy.
- Next missing CryptGetHashParam exposed inherited non-cryptographic checksum accumulation. Cartographer source xlive/Blam/Engine/math/crypto_windows.cpp requires CALG_SHA_256. Added five-argument API metadata and real SHA-256 via browser WebCrypto with JSPI suspension. CryptHashData snapshots each chunk; SHA-256 queries handle HP_ALGID/HP_HASHSIZE/HP_HASHVAL, NULL sizing, ERROR_MORE_DATA, output lengths, cached final digest and rejected updates after finalization. Write through fresh Mem after await. Other digest algorithms return unsupported rather than fabricated digest; other legacy crypto/key/signature shims are not certified.
- Contract reference: https://learn.microsoft.com/en-us/windows/win32/api/wincrypt/nf-wincrypt-cryptgethashparam . Tests verify empty and abc SHA-256 vectors, incremental hashing, mutated input memory, short-buffer sentinels, finalization and destruction/release.
- Chrome passes both crypto APIs, xlive attach returns success and runner requests sldl_dll DllMain at 0x13eb0a5a. Current honest failure: AOT native function not recompiled: 0x13eb0a5a. Last xlive debug block 0x131949c4. No unsupported instruction remains on this observed xlive attach path.
- NEXT: exact extracted sldl_dll.dll needs Ghidra CFG export/native recompilation. Expected runtime base 0x13c10000, preferred PE base 0x400000, entry preferred 0x6a0a5a. Then pccompat at 0x13f00000/entry0x13f2a118 (preferred0x10000000) and d3dx9_31 at 0x13f60000/entry0x1417af6c (preferred0x400000). Confirm PE headers/load bases before building; do not fake attach success. Actual TEB/TLS, dynamic attach and thread execution still pending.
- Validation: 1,067 tests / 0 failures / 5,348 assertions across 126 files; TypeScript clean. Private native-build59.json / halo2-native59.wasm: 31,187 functions, 89,317,389 bytes. Inputs cfg_full53 EXE + cfg_d3dx9_43_51d + cfg_xlive59; current public binary copied. Browser tab1897427854 retained; Vite5174.
- No AOT video/menu/gameplay/audio/controller/saves/60fps acceptance. Experimental EXE shell-success/queue substitutions remain inherited and unvalidated. Keep game binaries/CFGs/bundles/logs/captures/saves outside Git, bun.lock and unrelated Gemini changes unstaged. Root and repo handoffs updated; only own private repo for outward work, no PR merge or issue closure.

# NEWEST-58: ADD flag fidelity fixed; further native constructor reached

October 3, 2026. Recovered observed callback preferred 0x10059b30 using Ghidra into cfg_xlive58.json (9,963 xlive functions). Chrome executes it and reaches CMOVO at 0x130689cc in Cartographer object allocation/setup.

- Implemented CMOVO/CMOVNO plus JO/JNO conditions. The regression exposed inherited ADD clearing CF/OF instead of calculating them. Corrected ADD width masking and ZF/SF/PF/CF/OF/AF. Tests verify byte/word/dword wraps, signed overflow, parity and auxiliary carry; no claim that ADC/SBB or all arithmetic flags are now correct.
- Overflow test initially trapped because JO/JNO were unsupported; after adding conditions it failed on ADD overflow. Both defects corrected before live verification. Other legacy arithmetic/POPF AF omissions remain.
- Chrome passes observed CMOVO, still enumerates display modes, then reaches unresolved native constructor 0x13068b20, preferred 0x10068b20, return 0x13193d89, last block 0x13017070. Next recover verified callback and re-export xlive CFG, rebuild/boot. xlive attach still has not returned.
- Validation: 1,065 tests / 0 failures / 5,300 assertions across 125 files; TypeScript clean. Private native-build58.json / halo2-native58.wasm: 31,186 functions, 89,315,510 bytes; cfg_full53 EXE, cfg_d3dx9_43_51d and cfg_xlive58. Public binary copied. Assets/CFGs/binaries/logs stay private.
- No AOT title/menu/video/campaign/60fps acceptance. Prior warnings about true TEB/TLS, remaining DLLs, threads/dynamic attach, SSE rounding and experimental EXE shell/queue substitutions remain. Keep unrelated Gemini edits and bun.lock unstaged.
- Root AGENTS/CODEX-HANDOFF/HANDOFF and repo handoffs updated; only own private repo for outward work, no PR merge or issue closure.

# NEWEST-57: Cartographer reaches native display-mode enumeration

October 3, 2026. Ghidra recovered observed callback 0x101891e0 into cfg_xlive57.json (9,962 xlive functions). It runs two native helpers and returns a status value; Chrome passes it, initializing additional CRT critical sections.

- Added CMOVC/CMOVNC aliases using tested carry conditions. Added PUNPCKLBW/PUNPCKLWD interleaving low qwords into full 128-bit output with aliased source snapshots. Added PSRLDQ full-register byte shifting, crossing dword boundaries and clearing vacated bytes/counts >=16. MMX unpack forms explicitly trap.
- Chrome passes CMOVC 0x131c8c6e, PUNPCKLBW 0x131c9706, PUNPCKLWD and PSRLDQ 0x131c971e. Native Cartographer now enumerates 25 display modes (EnumDisplaySettingsW), a materially later setup phase. This is display setup, not rendered video or frame-rate acceptance.
- Current unresolved target 0x13059b30, preferred 0x10059b30, return 0x131aaf76, last debug block 0x131aaf54. Next Ghidra-recover verified target, rebuild and boot; then remaining native DLLs/true TEB/TLS/thread work. xlive process attach has not returned yet.
- Validation: 1,064 tests / 0 failures / 5,288 assertions across 125 files; TypeScript clean. Private native-build57.json / halo2-native57.wasm: 31,185 functions, 82,532,325 bytes, public binary copied. Inputs EXE cfg_full53, D3DX cfg_d3dx9_43_51d, Cartographer cfg_xlive57. Proprietary files and logs stay outside Git.
- No AOT title/menu/video/campaign/60fps acceptance. Preserve NEWEST-56 inherited rounding, TEB/TLS, remaining DLLs/dynamic attach/threads and experimental EXE shell/queue limitations.
- Root AGENTS/CODEX-HANDOFF/HANDOFF and repo handoffs updated. Unrelated Gemini edits and bun.lock remain unstaged; only own private repo for pushes/comments, no PR merge or issue closure.

# NEWEST-56: Native string routines and two recovered Cartographer entries

October 3, 2026. BSR/BSF implement highest/lowest-set-bit indexing with word masking and ZF for zero. Zero-source destination and other flags are architecturally undefined, not certified. PSHUFLW snapshots low-word shuffles and preserves upper source qword. PCMPEQW compares all eight words, ORPS combines all four bit lanes, PMOVMSKB extracts all sixteen sign bits. MMX variants remain explicitly unsupported.

- Ghidra recovered observed constructor 0x100e4f00 and omitted continuation 0x100ac352 into private cfg_xlive56b.json, now 9,961 functions. The continuation restores SEH/frame state; its diagnostic stack top was not a valid function-return slot, so do not infer stack corruption from 0x8d78ba18 alone. Native execution passes both recovered entries.
- Chrome passes BSR 0x130ab79e, PSHUFLW 0x1319669a, PCMPEQW 0x131966b8 and BSF 0x131966d0. Cartographer installs its exception filter, reads halo2.exe version resource, and reaches SetCurrentDirectoryW with an empty string (API currently reports success; investigate semantics if it becomes causal).
- Current stop: unresolved indirect target 0x131891e0, preferred 0x101891e0, return 0x1316a8d1, last debug block 0x13172c70. Next verify/recover the native function with Ghidra, then build/boot. No fake constructor success or API shortcut added.
- Validation: 1,062 tests / 0 fail / 5,271 assertions across 125 files; TypeScript clean. Private native-build56.json / halo2-native56.wasm uses cfg_full53 EXE, cfg_d3dx9_43_51d and cfg_xlive56b; 31,184 functions, 82,524,644 bytes. Public binary copied. Native private build remains untracked.
- D3DX attach succeeds; xlive attach has not returned. No AOT video/menu/campaign/60fps acceptance. Preserve rounding, true TEB/TLS, remaining DLLs/threads/dynamic attach and experimental EXE shell/queue warnings from previous checkpoints.
- Unrelated Gemini changes and bun.lock remain unstaged. Root AGENTS/CODEX-HANDOFF/HANDOFF and repo handoffs updated; only own private repo allowed for GitHub activity. No PR merge or issue closure.

# NEWEST-55: Packed CRT math executes; next stop BSR

October 3, 2026. Fixed SSE MOVQ to preserve all 64 low bits, clear the upper destination qword and store exactly eight bytes. Prior scalar-f32 implementation silently lost half the bits.

- Added PSRLQ/PSLLQ using independent logical qword shifts. Entire low source qword determines count; counts >=64 yield zero, rather than WASM's masked count behavior. Aliased count snapshots preserved. MMX shift/subtract variants explicitly trap; no claim of MMX support.
- Added ANDPD bit masks, wrapping PSUBD per-dword subtraction and CMPNLEPD full-qword masks, including unordered NaNs. Comparisons snapshot before destination overwrite.
- Tests: 1,057 pass / 0 fail / 5,221 assertions across 125 files; TypeScript clean. Shift tests caught an incorrect signed-LEB constant for 64, corrected before live boot.
- Whole build initially exposed unsupported MMX operands; restricted new packed instructions to XMM and rebuilt successfully. Chrome passes PSRLQ 0x131c7706, PSLLQ 0x131c7778 and CMPNLEPD 0x131c778e. CRT routine FUN_101c76f0 returns; execution reaches Cartographer FUN_100ab790.
- Current unsupported BSR ECX,EAX at runtime 0x130ab79e, preferred 0x100ab79e. Next implement accurate highest-set-bit semantics, zero-input ZF and operand widths with tests, then boot again.
- Private native-build55.json / halo2-native55.wasm uses unchanged build53 CFG inputs, 31,182 functions / 82,509,706 bytes. Current public binary copied. Proprietary builds/CFGs/logs/screenshot remain outside Git.
- D3DX attach succeeds; xlive attach still pending. No AOT video/menu/campaign/60fps acceptance. NEWEST-54 rounding limits and inherited shell/queue substitutions, TEB/TLS, remaining DLLs and threads limitations remain.
- Preserve unrelated Gemini edits and bun.lock unstaged. Main GitHub README updated; PR7 remains open; no issues closed.

# NEWEST-54: SSE double conversions pass native Chrome startup

October 3, 2026. Implemented CVTDQ2PD signed low-two-int conversion into packed binary64, ADDSD scalar addition preserving upper 64 bits, and CVTPD2PS conversion with upper 64 bits cleared. Sources snapshot before aliased destination writes. Binary64 XMM access uses i64 bitcasts, preserving all bits rather than scalar-f32 storage.

- Validation: 1,052 tests / 0 failures / 5,174 assertions across 125 files; TypeScript clean. Tests cover signed extrema, unsigned-max correction, aliasing, memory operands, upper-lane preservation/clearing, nearest-even ties and negative zero.
- Rounding limitation: WASM nearest-even conversion is supported; alternate MXCSR rounding modes and SSE exception reporting remain incomplete.
- Actual Chrome passes CVTDQ2PD 0x130ab570 and adjacent ADDSD/CVTPD2PS. Next unsupported instruction: PSRLQ XMM0,0x34 at runtime 0x131c7706, preferred 0x101c7706, FUN_101c76f0. This CRT math block also uses MOVQ, ANDPD and PSUBD; check existing MOVQ fidelity before claiming correct math.
- Private native-build54.json / halo2-native54.wasm preserves build53 inputs: 31,182 functions, 82,437,398 bytes. Public runtime binary copied; all proprietary outputs remain outside Git.
- D3DX attach succeeds; xlive attach has not returned. No AOT title/menu/video/60fps acceptance. Pending remaining DLLs, real TEB/TLS, dynamic attach and threads; inherited EXE shell/queue substitutions remain experimental.
- Preserve unrelated Gemini edits and bun.lock unstaged. Only sstewart207/halo2-browser is authorized for pushes/comments; do not merge PR7 or close issues.

# NEWEST-53: Locked increment, CRT memory fill and API argument metadata fixed

Oct 3, 2026. Codex continued while the user was away.

- GitHub issue bodies/titles 1,2,3,4,5,6,8,9,10 updated to distinguish historical v86 reports from current AOT acceptance. Historical reports preserved in collapsible sections; no issue closed. PR7 main title/body refreshed from stale NEWEST-28; no merge.
- Added INC.LOCK/DEC.LOCK for the single guest-thread AOT path; corrected plain INC/DEC width masking, OF/SF/ZF/PF/AF and CF preservation. PUSHFD now includes stored AF. Multi-thread atomic ordering is not certified. Other arithmetic/POPF AF support remains incomplete.
- Chrome passes prior INC.LOCK 0x131b79bb. Added BT after _memset stopped at 0x13197152: immediate/register bit indexing, operand-width masking, signed memory bit-string offsets, carry result. Added PSHUFD after next stop 0x13197177; source lanes snapshot before aliased writes, tested reverse/broadcast.
- Chrome exposed host TypeError in kernel32 LCMapStringEx: AOT passed four args instead of nine. RuntimeBridge now prefers registered dispatcher stub argCount, matching its existing stackCleanup metadata; no fabricated API success. Added contextual API errors with cause and tests verifying all nine argument slots and cleanup. Live Chrome passes the call after fix.
- Recovered 43 omitted xlive C/C++ initializer functions from exact native tables 0x1022a6ac..0x1022a6c8 and 0x1022a5f0..0x1022a6a0 (49 unique nonzero targets). Ghidra export cfg_xlive53.json has 9,959 functions. Private headless log tmp/recover-xlive53.log, extracted target list scratch/ghidra/xlive-init-targets53.json.
- Added CMOVA/AE/B/BE/L/LE/G/GE/S/NS/P/NP using the existing tested branch conditions after runtime stop 0x131b535e. Regression covers signed/unsigned ordering and equality.
- Final live Chrome stop: CVTDQ2PD XMM0,XMM0 at runtime 0x130ab570, preferred 0x100ab570, FUN_100ab480. Same block then uses ADDSD and CVTPD2PS for unsigned-int conversion/container load ratio. Next scope: accurate packed int-to-double, scalar double add and double-to-float lanes; preserve alias source and upper-bit semantics, document rounding limits.
- Private manifest native-build53.json: cfg_full53.json EXE + cfg_d3dx9_43_51d.json at 0x13a10000 + cfg_xlive53.json at 0x13000000. Validated 31,182 functions / 82,356,238 bytes; output halo2-native53.wasm copied to public/halo2_recompiled.wasm. Builds/CFGs stay private.
- Validation: 1,049 tests pass / 0 fail across 125 files, 5,162 assertions; TypeScript clean. D3DX attach still succeeds. xlive attach has not returned yet. No AOT video/menu/gameplay/60 FPS/audio/controller/saves acceptance.
- Preserve previous warnings: experimental EXE successful-shell/synchronous-queue CFG substitutions, pending true TEB/TLS, remaining DLLs, dynamic attach and threads. Preserve unrelated Gemini edits unstaged and bun.lock/assets/logs/saves outside Git.

# NEWEST-52: MOVLPD fixed; Cartographer native CRT progresses farther

Oct 3, 2026. Codex continued from NEWEST-51 and verified each new build in desktop Chrome.

- Original refresh error 0x131957c4 is resolved live. Root cause: XMM registers had only a scalar f32 local, losing upper bits. Added shared four-i32-lane globals for each XMM0..7, exported as xmmN_laneM. Bit-preserving moves now copy all relevant lanes across functions; scalar float arithmetic reads/writes the low lane.
- Implemented MOVLPD/MOVLPS low-64-bit load/store with upper-register preservation; corrected MOVSS memory-load clearing versus register-copy preservation, full MOVAPS/MOVAPD/MOVDQA moves, unaligned MOVUPS/MOVUPD/MOVDQU, XMM MOVD upper clearing, and full-lane XORPS/XORPD/PXOR for distinct registers. SSE MOVSD uses low-64-bit copying, distinct from the existing string MOVSD path. No claim of complete SIMD fidelity: alignment exception semantics, MMX, MOVQ, packed arithmetic and several instructions remain incomplete.
- Chrome next stopped at XCHG 0x13199b5e. Implemented register/memory exchange, evaluating/storing memory before changing an address register; arithmetic flags preserved. Current AOT has one guest thread, so this does not certify multi-thread atomic ordering.
- Chrome then exposed missing CRT initializer 0x131b55a6, then 0x131b55d5. Ghidra recovered the first observed target, then all entries from the exact __acrt_initialize table 0x10234b18..0x10234b98 (20 unique nonzero init/uninit targets). Added 13 missing functions total; cfg_xlive52b.json now has 9,916 functions. Logs and extracted tables remain private.
- Implemented CMOVZ/CMOVE/CMOVNZ/CMOVNE after Chrome stopped at 0x131b9a67. Tests cover true/false selection and unchanged flags. Final live stop: unsupported INC.LOCK dword ptr [EAX] at runtime 0x131b79bb, preferred 0x101b79bb, in a named CRT lambda operator. Next: inspect existing INC flag semantics and add single-thread locked increment support with a regression; do not fake success or claim multi-thread atomics.
- Current private build manifest: scratch/ghidra/native-build52.json, EXE cfg_full53.json + D3DX cfg_d3dx9_43_51d.json at 0x13a10000 + xlive cfg_xlive52b.json at 0x13000000. Output halo2-native52.wasm copied to public/halo2_recompiled.wasm: 31,139 functions / 81,213,784 bytes. Build validates. DLL load-base guards remain enabled.
- Validation: TypeScript clean; 1,039 tests pass / 0 fail, 5,118 assertions across 123 files. New tests include nonzero/NaN bit patterns, neighboring memory, upper-lane preservation, cross-function XMM state, actual distinct-register XOR, XCHG with its own address register and CMOV conditions.
- Local Vite server had stopped, causing Failed to fetch after refresh. Restarted on 127.0.0.1:5174; Chrome reload/bundle load works. Current dev server shell session 92934. Browser tab 1897427847 is retained for next boot.
- D3DX attach still succeeds; xlive attach has not completed. No AOT title/menu/video, campaign or 60 FPS acceptance. Remaining native DLLs, actual TEB/TLS, dynamic DLL attach and thread callbacks remain pending. Preserve NEWEST-51/50 warnings about experimental EXE shell/queue substitutions.
- Unrelated Gemini runtime/filesystem edits remain unstaged. Preserve bun.lock, bundles, CFGs, binaries, saves, logs and screenshots outside Git. Only push/comment in sstewart207/halo2-browser; do not merge PR7 or close issues.

# NEWEST-51: Native D3DX attach succeeds; Cartographer DLL executes in AOT

Oct 2, 2026. Codex continued the native DLL execution work after NEWEST-50.

- The EXE-only module omitted real DLL entry points. Runner now invokes pending native DLL_PROCESS_ATTACH callbacks before the EXE, checks their BOOL return, and marks initialization only on success. Missing compiled entries and mismatched DLL load bases stop explicitly.
- Real DLL exports bypass HLE and execute compiled functions; native IAT target addresses are preserved. DLL import names are collected so SDK imports parse correctly. Removed fabricated pccompat success and mutex fallback from the active src RuntimeBridge. Gemini's delay-import bindings and argument-count additions are preserved in the committed runtime files; unrelated Gemini edits remain unstaged.
- Added tools/recompile-native-cfg.ts and relocation-aware tools/recompiler/rebase-cfg.ts. Use private manifest inputs; merge EXE/DLL functions into one module with shared register globals. PE HIGHLOW records identify relocatable operands; constants are not rebased by guesswork. Unsupported relocations and ambiguous operands reject the build.
- Ghidra exported exact bundled d3dx9_43.dll and existing xlive.dll. Recovered observed D3DX C/C++ constructor entries, including 66 missing functions from its initializer table. Final D3DX CFG cfg_d3dx9_43_51d.json has 4,674 functions; cfg_xlive51.json has 9,903.
- Routed msvcrt _initterm/_initterm_e callbacks into compiled exports instead of the old CPU scheduler. Callback tables are validated before execution; _initterm_e propagates failure. Added MOVSD/MOVSD.REP, CLD/STD and FDIVRP with regressions. Unsupported AVX instructions compile as explicit address-reporting traps without parsing YMM operands; this is not AVX support.
- Verified desktop Chrome: D3DX DllMain at 0x13bcec0d returns success, then xlive DllMain at 0x131949ff executes. Current honest stop is MOVLPD at runtime 0x131957c4, preferred 0x101957c4, in FUN_101957b7 (CRT security-cookie setup). Exact operand: qword ptr [EBP + -0xc], XMM0, preceded by XORPS XMM0, XMM0. Implement bit-accurate low-64-bit SSE semantics; do not generalize a zero-store shortcut.
- Latest private manifest scratch/ghidra/native-build51x.json combines cfg_full53.json, cfg_d3dx9_43_51d.json at base 0x13a10000, and cfg_xlive51.json at base 0x13000000. Build: 31,126 functions, 80,204,428 bytes, 62,278 Chrome exports, compile 49.37 ms. Output scratch/ghidra/halo2-native51.wasm copied to public/halo2_recompiled.wasm (generated assets stay private).
- Validation: TypeScript clean; 1,033 tests pass / 0 fail across 122 files, 5,103 assertions. Tests verify native import routing, IAT preservation, attach ordering/failure/base guards, constructor execution, relocation selection, string copy directions and floating-point reverse divide/pop.
- Next DLLs after xlive: sldl_dll at 0x13c10000 / entry 0x13eb0a5a; pccompat at 0x13f00000 / entry 0x13f2a118; d3dx9_31 at 0x13f60000 / entry 0x1417af6c. Their exact bundled PE files are extracted privately in scratch/ghidra. They still need recompilation and validated attach execution. Check bases against live loader before builds.
- Outstanding: real TEB/TLS reconciliation (runner uses 0x30000; scheduler main TEB 0x1302000), native dynamic LoadLibrary attach continuation, compiled thread callbacks, full SIMD/x87 semantics. Native CRT callback bridge is implemented only for _initterm/_initterm_e.
- Preserve NEWEST-50 warning: cfg_full53 still includes Gemini's experimental successful-shell and synchronous-queue substitutions. This checkpoint does not certify faithful whole-game recompilation. No AOT title/menu/frames, 60 FPS, gameplay/audio/controller/save acceptance. No playable-build clock ETA is supported.
- Bundles, game DLLs, CFGs, logs, screenshots, saves and accounts remain outside Git. bun.lock stays unstaged. Do not touch upstream repos or merge PR7/close issues.

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

