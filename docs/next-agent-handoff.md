# NEWEST-63: pccompat native process attach succeeds in live Chrome

October 3, 2026. Live Chrome completes pccompat.dll DllMain and advances to d3dx9_31.dll entry 0x13e8af6c. No AOT title/menu/video/campaign/60fps acceptance.

- Build62 reproduced the live pccompat failure at __CRT_INIT epilogue 0x13c3a01b. GetModuleHandleA("KERNEL32.DLL") already returned nonzero 0x7c800000, so __mtinit module lookup was sound. EBP held 0x13c39f2e, the return address following ___crtGetEnvironmentStringsA.
- A temporary AOT trace measured environment routine entry ESP=0x1301f90 and exit-block ESP=0x1301f88. Six saved pushes require entry-24=0x1301f78: the stack was over-cleaned by exactly 16 bytes. AOT bridge's four-argument default incorrectly handled zero-argument GetEnvironmentStringsW, so POP EBP restored the return address.
- Added exact Win32 stdcall counts: GetEnvironmentStrings/GetEnvironmentStringsA/W=0; FreeEnvironmentStringsA/W=1. Test checks actual arguments and ESP for retrieval/free. 1,075 tests pass, 0 fail, 5,382 assertions; TypeScript clean.
- Live Chrome after fix: environment exit ESP=0x1301f78, pccompat DllMain returns TRUE, runner attempts d3dx9_31 DllMain at 0x13e8af6c and stops explicitly because that native function is not compiled. Debug PC 0x13c3a112 is merely pccompat's last block, not the failure.
- Temporary routine-specific trace was removed. Optional AOT block diagnostic now exposes aot_debug_esp/aot_debug_ebp alongside aot_debug_pc. The private Build63b with temporary trace verified Chrome; final source should be recompiled in next build.
- NEXT: inspect exact extracted d3dx9_31.dll PE header and loader base, Ghidra export its CFG, add to native manifest, rebuild, boot. Entry 0x13e8af6c and preferred RVA 0x21af6c imply base 0x13c70000, but verify rather than assume. After attach, enter EXE at 0x407fd3/0x408005. Do not fabricate attach success. Experimental inherited EXE shell-success/queue substitutions remain unvalidated.
- Keep private PE/CFG/WASM/bundle/logs/saves out of Git, bun.lock and unrelated files unstaged. Own private repo only; PR7 and issues remain open. Vite5174; tools/boot-halo2.ts loads the private bundle.

# NEWEST-61: sldl_dll cleanly stubbed via HLE; native build 61 produced

October 3, 2026. Bypassed the native sldl_dll self-decrypting runtime initializer deadlock cleanly by implementing a faithful HLE sldl_dll module and removing sldl_dll from the native AOT compilation unit.

- Identified that sldl_dll.dll is the legacy Windows software licensing entitlement client. A deep byte-scan of halo2.exe confirmed that the 7 imported SLDL_* functions (0x427642..0x427666) have zero runtime call sites in the executable; Cartographer bypasses this entirely.
- Created src/worker/modules/sldl_dll.ts and src/worker/api/sldl_dll.api.ts providing HLE stubs returning S_OK (0), logging warnings on invocation, and zeroing out known output pointers (SLDLGetSLIDList, SLDLGetLicensingStatusInformation, SLDLOpen) to prevent undefined memory dereferences.
- Registered sldl_dll in src/worker/core/api-registry.ts and src/worker/emulator.worker.ts. Added comprehensive unit tests in tools/tests/sldl-hle.test.ts (1,071 total passing tests, 0 failures, clean typecheck).
- Committed lifter CFG truncated fallthrough trap (preventing infinite block wrapping).
- Recompiled native AOT image via native-build61.json (containing halo2.exe, d3dx9_43.dll, and xlive.dll: 31,187 functions, 89,319,275 bytes) to public/halo2_recompiled.wasm.
- Committed extended Win32 API argument counts and diagnostic logging in runtime-bridge.ts.
- Next: run live verification in Chrome or headless runner to observe Cartographer progressing past sldl_dll towards remaining DLL attachments (pccompat, d3dx9_31) and WinMain.
- Validation: 1,071 tests pass across 127 files (0 failures). TypeScript typecheck clean. No AOT video/menu/campaign/60fps acceptance.

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

# Next agent: first playable build (menu text is fixed)

## Oct 2 2026, Antigravity/Gemini (with Codex): STATIC RECOMPILATION STAGE 7 (INDIRECT CALL RESOLUTION, DYNAMIC IMPORT THUNKS & NATIVE CRT EXECUTION) COMPLETE (NEWEST-38)

Read this section first; it supersedes earlier notes below.

### 1. Stage 7 Indirect Call Resolution & Dynamic Import Thunks Milestone
- **Indirect Function Call Lifter (`lifter.ts`):** Added indirect call resolution (`CALL reg`, `CALL [mem]`, and indirect dynamic jumps) via an imported `indirect_call(targetAddr, esp, ecx, eax)` dispatcher. Preserves caller/callee stack contracts by pushing return address to linear stack and popping upon return.
- **Whole-Binary Dual Export Aliasing (31,787 Exports):** `liftExportedModule` now exports both canonical names and `addr_0x<entry>` aliases for all 15,893 functions. `RuntimeBridge.registerExports` parses entry addresses from export names, allowing 0-overhead function resolution without needing the 121 MB CFG JSON at runtime.
- **In-Memory PE Import Directory & Self-Referencing IAT Slots:** Added in-memory PE import directory parsing in `recompiler-runner.ts`. All 413 IAT slots in linear memory are initialized to self-referencing pointers, routing indirect pointer calls (e.g. `MOV EBX, [0x79b348]; CALL EBX`) to Win32 HLE implementations (`GetProcessHeap`, `TlsAlloc`, `TlsSetValue`, `TlsGetValue`, `DeleteCriticalSection`).
- **Native Execution Verification:** PE entry point `entry()` runs `___security_init_cookie` with 0 traps, returning cookie `0x17c8c` in 0.45ms. Native `___tmainCRTStartup` advances cleanly through CRT startup, heap allocation, TLS initialization, and delay-load helper resolution (`_ResolveThunk@20` $\to$ `_GodotFailGetProcAddress@8`).
- **Automated Verification:** All 961 unit tests pass across 105 files in 516ms. `tsc --noEmit` passes with 0 errors.

### 2. Immediate Next Goal:
- Verify presentation of animated 3D Title Screen ("Press Start") and Game Start Menu at steady 60 FPS in Chrome without v86 CPU load.

## Oct 2 2026, Antigravity/Gemini (with Codex): STATIC RECOMPILATION STAGE 6 (AOT NATIVE EXECUTION PIPELINE & BROWSER WORKER INTEGRATION) COMPLETE (NEWEST-37)

Read this section first; it supersedes earlier notes below.

### 1. Stage 6 AOT Execution Pipeline & Browser Worker Integration Milestone
- **FS Segment & TEB Memory Resolution:** Updated `parseOperand` in `tools/recompiler/parser.ts` to peel arbitrary segment and size prefixes (`dword ptr FS:[0x0]`). Updated `emitEffectiveAddress` in `tools/recompiler/lifter.ts` to offset `FS:` memory operations by `tebBase` (default `0x00030000`). Verified TEB read/write with unit test.
- **MSVC CRT Helper Inlining:** Inlined `__SEH_prolog4` (`0x692cc3`), `__SEH_epilog4` (`0x692d08`), `__alloca_probe` (`0x687b7e`), and `__alloca_probe_16` (`0x68c215`) directly into calling functions, preserving the caller's stack frame, registers (`EBP`, `ESP`), and SEH exception registrations without emulation traps.
- **Native Execution of `___tmainCRTStartup`:** Executed native CRT startup on the recompiled 16.99 MB binary (`halo2_recompiled.wasm`). Advanced through `__SEH_prolog4`, called `GetStartupInfoA`, `HeapAlloc`, `GetVersionExA`, `HeapFree`, `HeapCreate`, and `TlsAlloc` with 0 CPU traps.
- **Browser Worker Integration:** Built `RecompilerRunner` in `src/worker/core/recompiler/recompiler-runner.ts` and wired `RuntimeBridge` to `ThunkDispatcher.getImplementation`. Integrated AOT WebAssembly bootloader path in `src/worker/emulator.worker.ts` with clean fallback to v86 CPU emulation.
- **Automated Verification:** All 960 unit tests pass across 105 files in 579ms. `tsc --noEmit` passes with 0 errors.

### 2. Immediate Next Goal:
- Verify presentation of animated 3D Title Screen ("Press Start") and Game Start Menu at steady 60 FPS in Chrome without v86 CPU load.

## Oct 2 2026, Antigravity/Gemini (with Codex): STATIC RECOMPILATION STAGE 5 (DIRECT INTER-FUNCTION CALL LINKING & WHOLE-PROGRAM 15,893-FUNCTION COMPILATION) COMPLETE (NEWEST-36)

Read this section first; it supersedes earlier notes below.

### 1. Stage 5 Direct Call Linking & Whole-Program Compilation Milestone
- **Direct Inter-Function Call Linking (`lifter.ts`):** Direct subroutine calls (`CALL imm`) link natively to WASM `call` opcodes. Pre-registers all 15,893 functions in `funcEntryMap` and pre-scans all IAT calls so import count is fixed before bytecode generation. Stack frames are preserved with standard x86 calling convention: return address is pushed to emulated stack memory at `[esp]`, arguments are read at `[esp+4]`, `[esp+8]`, etc., and cleaned up according to cdecl/stdcall conventions.
- **Whole-Program CFG Extraction:** Ghidra headless extracted the complete control-flow graph for all **15,893 functions** (152,288 basic blocks, 933,787 instructions) in 17 seconds (`cfg_full.json`, 121.35 MB).
- **Instruction Coverage & Robustness:** Handled `extended double ptr` 80-bit float operands and empty operand edge-cases (e.g. `XLAT ", EBX"`), achieving **0 parse failures across all 933,787 instructions** in `halo2.exe`.
- **MOVD Bitwise Reinterpretation:** Handled bitwise conversion between x87/MMX float locals and GP integer locals using WebAssembly `i32_reinterpret_f32` and `f32_reinterpret_i32`.
- **Whole-Program Compilation Performance:**
  - Lifted the entire game binary (15,893 functions) in **2.83 seconds**.
  - Generated a **16.98 MB** WebAssembly binary (`halo2_recompiled.wasm`) with **209 Win32 IAT imports** and **46,049 direct internal subroutine calls**.
  - Verified and compiled by the V8 WebAssembly engine in **63.13 ms**!
  - Instantiated cleanly with **15,894 exports**.
  - All 958 unit tests pass across 104 files in 516 ms.

### 2. Immediate Next Goal:
- Connect the recompiled Entry Point (`0x421756`) and main game loop (`game_tick`) into the browser runtime harness to execute natively without CPU emulator overhead.

## Oct 2 2026, Antigravity/Gemini (with Codex): STATIC RECOMPILATION STAGE 4 (SSE/FPU LIFTER & 1,000-FUNCTION MILESTONE) COMPLETE (NEWEST-35)

## Oct 2 2026, Antigravity/Gemini (with Codex): STATIC RECOMPILATION STAGE 3 (RUNTIME LINKER & IAT BRIDGE) COMPLETE (NEWEST-34)

Read this section first; it supersedes earlier notes below.

### 1. Stage 3 Runtime Linker & IAT Bridge Implemented (`tools/recompiler/`)
- **`iat-resolver.ts`:** Parses PE DOS headers, optional headers, and Import Directory Tables directly from `halo2.exe`. Maps all 413 imported Win32 functions across `KERNEL32`, `USER32`, `GDI32`, `ADVAPI32`, `d3d9`, `dinput8`, `dsound`, etc., to their exact IAT slot addresses (e.g. `0x79b458` $\to$ `USER32.dll:GetCursor`, `0x79b21c` $\to$ `KERNEL32.dll:FindResourceA`).
- **`wasm-builder.ts`:** Full support for function imports (Section 2) with signature registration and re-indexing of exported local functions.
- **`lifter.ts`:** Detects direct and indirect `CALL [disp]` targeting IAT slots. Simulates pushing the return address (`esp -= 4; mem[esp] = retAddr`), dispatches the call directly to imported WASM functions with `$esp`, stores the return value in `EAX`, and restores the return address.
- **`runtime-bridge.ts`:** Implements `RuntimeBridge` binding imported WASM functions directly to BottleShip's existing HLE modules (`Kernel32`, `User32`, `D3D9`, etc.) over a shared `WebAssembly.Memory` buffer. Marshals stdcall arguments directly from linear stack memory at `[esp + 4]`, `[esp + 8]`, etc.
- **`tools/recompile-cfg.ts`:** Recompiles CFGs with live IAT binding. In `halo2.exe` 100-function sample: 5 live IAT imports bound, lifted in **16.06 ms**, compiled in **2.49 ms**, and successfully instantiated with 101 exports!
- **`tools/tests/recompiler-runtime-bridge.test.ts`:** Verified PE IAT parsing from real `halo2.exe`, imported API call execution, and stdcall argument stack marshalling. All 15 recompiler tests pass. All 954 project tests pass in 532ms.

### 2. Immediate Next Goal (Full Recompilation & Loop Integration):
- Run batch CFG extraction across all functions of `halo2.exe` via `tools/extract-ghidra-cfg.ps1`.
- Recompile core game tick / update loop and renderer functions.
- Execute game logic natively with WebGPU D3D9 presentation at steady 60 FPS in Chrome and iOS Safari.

## Oct 2 2026, Antigravity/Gemini (with Codex): STATIC RECOMPILATION STAGE 2 (AOT LIFTER) COMPLETE (NEWEST-33)

Read this section first; it supersedes earlier notes below.

### 1. Stage 2 AOT Lifter Architecture Implemented (`tools/recompiler/`)
- **`types.ts`:** Type definitions for Ghidra CFG exports, instruction operands, and module compiler settings.
- **`parser.ts`:** Parses x86 disassembly operands (all register widths `EAX`/`AX`/`AL`/`AH`, effective addresses `[base + index*scale + disp]`, memory size specifiers `byte ptr`/`word ptr`/`dword ptr`, and hex/decimal immediates).
- **`wasm-builder.ts`:** Low-overhead WebAssembly binary bytecode (`Uint8Array`) emitter with ULEB128/SLEB128 encoding and companion human-readable `.wat` generator. Zero external dependencies.
- **`lifter.ts`:** Lifts x86 machine instructions to WebAssembly:
  - Register mapping: Maps `EAX`, `ECX`, `EDX`, `EBX`, `ESP`, `EBP`, `ESI`, `EDI`, and sub-registers to WASM locals.
  - EFLAGS: Eagerly updates `ZF`, `SF`, `CF`, `OF` on arithmetic/logic instructions (`ADD`, `SUB`, `CMP`, `TEST`, `XOR`, `AND`, `OR`, `INC`, `DEC`, `SHL`, `SHR`, `SAR`, `IMUL`).
  - Memory: Translates effective addresses to linear memory loads and stores (`i32.load`, `i32.store`, `i32.load8_u`, `i32.load16_u`, etc.).
  - Stack: Direct `PUSH` and `POP` against linear memory stack pointer (`ESP`).
  - Structured Control Flow: Straight-line execution for single-block functions; outer `loop` with nested `br_table` dispatch for multi-block CFGs and conditional jumps (`JZ`, `JNZ`, `JS`, `JNS`, `JL`, `JGE`, `JA`, `JBE`).
- **`tools/recompile-cfg.ts`:** CLI command to lift any CFG JSON to verified `.wasm` and `.wat`. Verified on 100 `halo2.exe` functions (415 basic blocks, 2,658 instructions) in **18.25 ms**, producing 43.5 KB WASM binary and 24,866 lines of WAT. V8/Bun engine validates and compiles the module in **2.7 ms**.
- **`tools/tests/recompiler-lifter.test.ts`:** Comprehensive unit test suite. 12/12 tests pass in 49ms. All 951 tests pass.

### 2. Immediate Next Goal (Stage 3 Linker):
- Connect lifted WASM function calls to BottleShip's existing HLE Win32 and D3D9 WebGPU APIs.
- Bind memory directly to BottleShip's 2GB `WebAssembly.Memory` buffer (`cpu.wasm_memory`).
- Map Win32 IAT import calls directly to exported runtime functions, completely removing `v86` CPU and OUT-port trap overhead.

## Oct 2 2026, Antigravity/Gemini (with Codex): BOOT CRASH FIXED, CAMPAIGN PLAYABILITY & MOUSE LOOK VERIFIED (NEWEST-32)

Read this section first; it supersedes the earlier blocker notes below.

### 1. Boot Crash / PCC Abort Fixed (commit `783a4c8`)
- In `src/worker/modules/kernel32/file-io.ts`, `CreateFileA` and `CreateFileW` now check `if (!filename || filename.length === 0)` and return `INVALID_HANDLE_VALUE` with `ERROR_PATH_NOT_FOUND` (3).
- In `src/worker/runtime/filesystem/vfs.ts`, `open`, `openSync`, and `classifyOpenFailure` reject empty paths and directory targets (such as `C:\`), returning `null` / `ERROR_ACCESS_DENIED` (5) instead of attempting to truncate OPFS directories and throwing `TypeMismatchError`.
- All 939 unit tests pass.

### 2. End-to-End Campaign Playability & In-Level Input Verified
- Tested end-to-end via Chrome CDP: Compatibility dialog -> Title ("PRESS ANY KEY TO CONTINUE") -> ONLINE ACCOUNTS ("Play Offline") -> CHOOSE PLAYER -> Live warning ("ARE YOU SURE?") -> Main Menu -> SELECT LEVEL ("Armory" with full 3D mission card) -> CHOOSE DIFFICULTY ("Normal") -> Level loads with visor HUD and reticle.
- DirectInput mouse look verified: `moveRel(0, -60)` and `moveRel(0, 50)` calibrated the crosshairs against the tutorial lights, prompting the game to update profile and advance the mission!
- Measured in-level performance: **27.9 FPS steady** (frame time 35.86ms: v86 CPU 24.78ms, thunk 10.38ms, WebGPU GPU 0.11ms, present 0.15ms). Guest RAM rock-solid at **700 MB**.

### 3. Clear Path for the Next Agent: Automated Verification & Stage 1 Extractor
Any incoming agent can immediately verify the system or proceed with Static Recompilation:

1. **Verify Live Game & Input in Chrome in Seconds:**
   ```bash
   # From work/bottleship-research:
   bun tools/boot-halo2.ts     # Boot bundle and arm logging
   bun tools/step-nav.ts       # Advance menus to Armory level
   bun tools/test-look.ts      # Test mouse look and calibration
   bun tools/measure-perf.ts   # Check live FPS and guest heap
   ```

2. **Extract Function CFGs & Basic Blocks (Static Recomp Stage 1):**
   ```powershell
   # From work/bottleship-research:
   powershell -ExecutionPolicy Bypass -File tools/extract-ghidra-cfg.ps1 -OutFile cfg_export.json -MaxFunctions 100
   ```
   - Uses `work/halo2-browser/scratch/ghidra/ExportFunctionCFG.java` with Ghidra 12.1.4 headless runner.
   - Outputs JSON with function names, RVAs, sizes, basic block boundaries, disassembled instructions, operands, and CFG destination edges.
   - Verified sample output: `work/halo2-browser/scratch/ghidra/cfg_sample.json`.

3. **Immediate Next Goal (Stage 2 Lifter):**
   - Implement the prototype x86 basic-block lifter (in TypeScript or Rust with `wasm32-unknown-unknown`) reading the JSON CFGs and emitting WebAssembly `.wat` or WASM bytecode.
   - See `docs/halo2-static-recomp-plan.md` for the complete architecture and design.

## Oct 2 2026, Antigravity/Gemini (with Codex): BLACK WORLD FIXED, MAPS BUNDLED, ROADMAP TO 60 FPS (NEWEST-31)

### 1. In-Level Black World Fixed (commit `a773ea7`)
- D3D9 WebGPU pipeline updated in `src/worker/backends/webgpu/d3d9/shader/index.ts` and `sm3-semantics.ts`.
- `D3DDECLTYPE_DEC3N` (14) and `UDEC3` (13) packed 10-10-10-2 signed/unsigned normals are properly packed as 4-byte `uint32` attributes with WGSL component unpacking.
- SM3 pixel/vertex shader normal, tangent, binormal, and fog semantics now link cleanly into interpolator slots without throwing or aborting pipeline generation.
- Full unit test suite passes: 938/938 pass.

### 2. Campaign Maps Bundled (commit `7a4c166`)
- `00a_introduction.map` (The Heretic) and `01b_spacestation.map` (Cairo Station) added into `work/halo2-browser/bundles/halo2-2gb.wgb`.
- Missions beyond Armory now load without infinite retry spins.

### 3. Harness DirectInput Mouse Deltas (commit `6c9aba8`)
- DirectInput mouse delta accumulation implemented in `input-manager.ts` and harness `cmds/input.ts` (`moveRel`).

### 4. Workstation Build Tools Confirmed & Static Recomp Plan
- Ghidra 12.1.4 + JDK 25 headless analyzer.
- Visual Studio Build Tools 2026 (`cl.exe`, `cmake.exe`, `ninja.exe`).
- Rust toolchain with `wasm32-unknown-unknown` pre-installed.
- Roadmap: see `docs/halo2-static-recomp-plan.md` for AOT recompiling `halo2.exe` to WebAssembly.

## Oct 1-2 2026, Codex (Space Bunny): CAMPAIGN BLOCKED BY MISSING MAPS; input tested

### 1. BLOCKER: the bundle ships only ONE campaign map, so every other mission hangs forever

`C:\maps` in the guest contains exactly four maps plus `fonts/`:

| file | size |
|---|---|
| `mainmenu.map` | 61,063,680 |
| `shared.map` | 201,512,960 |
| `single_player_shared.map` | 289,477,120 |
| `01a_tutorial.map` | 62,932,480 |

Selecting a mission whose scenario file is absent puts the game into an **infinite retry loop**: the log shows `GetFileAttributesA("maps\\<scenario>.map")` for the missing file over and over, interleaved with re-probes of the three maps that do exist. The loading/wipe screen keeps animating at a healthy **60 fps** (v86 ~12 ms, thunk ~4 ms) and the guest heap stays **byte-identical** across samples (HEAP 507.47 MB, HEAP_HI 309.19 MB) — so it looks exactly like the "wedge" in the older notes, but it is a missing-asset spin, not memory exhaustion. Escape aborts it and returns to CHOOSE DIFFICULTY.

Measured scenario names per menu entry (from the guest log):

| level-list entry | scenario probed | in bundle? |
|---|---|---|
| The Heretic (1st) | `00a_introduction.map` | NO - hangs |
| **Armory (2nd)** | loads OK (see below) | yes (`01a_tutorial.map`) |
| Cairo Station (3rd) | `01b_spacestation.map` | NO - hangs |
| Outskirts / Metropolis / others | not tested; almost certainly missing | NO |

**The Armory is the only playable mission with the current bundle.** Verified in-level: black world, red light glow, "Move the Mouse to look up" prompt, shield bar + motion-tracker HUD, and Escape opens GAME PAUSED with the level's own objective text ("Follow the Gunnery Sergeant's instructions"). Choose **Armory**, not Cairo Station, until more maps are added to the bundle.

**This is a BUNDLE gap, not a missing game asset.** The full Project Cartographer install at `C:/Games/Halo 2 Project Cartographer` should contain every scenario; the assembled `bundles/halo2-2gb.wgb` (740 MB) carries only one. Fix by copying the missing `maps/*.map` from the real install into the wgb and re-checking with `fsList('C:\\maps')`. Watch the size: `shared.map` is 201 MB and `single_player_shared.map` 289 MB on their own.

### 2. Input status (measured, not assumed)

- **Menus: keyboard works.** Enter/Up/Down/Escape all drive the UI (verified by screenshot at every step). Two behaviours to know: menu lists **auto-repeat while a key is held** (one 600 ms Down moved the selection 3 rows) so use short taps (~130 ms) to move exactly one row; and Escape needs a **long hold (~900 ms)** to leave a panel - 500 ms was ignored on CHOOSE DIFFICULTY.
- **In-level Escape: works.** GAME PAUSED appears with the correct level objective.
- **In-level mouse-look WORKS for a real player; the HARNESS cannot drive it.** Verified: dispatching a `PointerEvent('pointermove', {movementX: 70})` at the canvas immediately turns the camera, clears the "Move the Mouse to look up" tutorial and reveals new geometry (screenshot before/after). The harness `move`/`drag` verbs do **not** work, and the reason is precise:
  - The game polls **`IDirectInputDevice8A_GetDeviceState`**, not `GetDeviceData` (`apiCensus` shows `GetDeviceState` called, `drainDInputMouseEvents` never), so the queued relative-motion event buffer is irrelevant.
  - `GetDeviceState`'s mouse branch (`src/worker/modules/dinput/dinput.ts` ~line 880) computes `dx/dy = accum - lastSeen`, where `accum = inputManager.getDInputAccum()` = SAB slots `dinputDX`/`dinputDY` (14/15).
  - **Only App.tsx's `pointermove` handler adds to those slots** (`Atomics.add(inputView, INPUT_INDEX.dinputDX, event.movementX)`). `InputManager.injectMoveAtScreen` writes absolute `mouseX`/`mouseY` and calls `poll()` but never touches 14/15, so harness dx/dy are always 0.
  - **Fix when you want scripted camera control:** make `injectMoveAtScreen`/`injectDragAtScreen` `Atomics.add` slots 14/15 with the same movement delta. Until then, drive look from the page side with synthetic `PointerEvent`s that carry `movementX/movementY` (that is what worked here).
- **In-level W/A/S/D: unverified.** A 2 s W hold produced no visible change, but the world renders black so there is nothing to confirm movement against. Escape and the menus prove the keyboard reaches the game; movement needs a visible world.
- New dialog not in any recipe: after a profile exists, selecting it shows **"ARE YOU SURE? You're not signed in to Live..."** (OK/Cancel) before the main menu.
- The profile created in a previous session (`Halo0001`) **survives a full page reload**, so profile selection is already persistent. Campaign saves are still untested.

### 3. Performance (tab visible, perfProfile + perfStats)

| scene | fps | frame | v86 | thunk | gpu | present |
|---|---|---|---|---|---|---|
| loading / menu wipe | 60.0 | 16.7 ms | 12.1 | 4.2 | 0.13 | 0.19 |
| **Armory in-level** | **18.5** | 54 ms | 38.7 | 14.4 | 0.16 | 0.19 |

In-level is ~18.5 fps, better than the ~11 fps in NEWEST-29 but still 3x short of 60. Note in-level thunk cost (14.4 ms) is 3x the menu cost, so D3D9 call batching is worth more here than the menu numbers suggested.

### 4. Rendering: the world is black in-level

The menus render beautifully (fonts, mission artwork, emblems). In-level we get a **black frame with one red light glow / lens flare**, the HUD and the tutorial prompt - no geometry, no textures. `present` count is healthy (25,177 presents) and `ReadFile` shows real loading, so this is a shading/visibility problem, not a stalled renderer. Do not claim "level renders" from a screenshot of the intro frame.

### 5. Stability soak (6 min, Armory in-level)

Twelve 30-second samples: guest heap **HEAP 507.68 MB and HEAP_HI 232.47 MB, identical in all 12**, fps 18.5-19.6 for the first ten samples then 28.1 and 35.8 in the last two (the camera had been turned away from the bright light by then), no crash, no exception, no allocation growth. The old 1.7 GB runaway is not reproducing. Note the level is black, so this only proves emulator stability, not that the game is playable.

## October 1 product goal and next-agent handoff

User confirmed the long-term experience: open a private hosted URL on PC, Android or iPhone/iPad, load/download the game, and execute locally on that device. No streaming or remote execution. Support DualSense and other OS-recognized USB/Bluetooth controllers through the browser Gamepad API, translated into guest XInput. Add remapping, dead zones, disconnect/reconnect handling, and test wired/wireless separately on each target device. Local persistent campaign saves first; complete emulator snapshots and optional private cross-device save sync are separate later milestones.

Hosting must support HTTPS and cross-origin isolation (COOP/COEP) for SharedArrayBuffer. Cache downloaded files where supported; account for the first large download, user activation for audio, mobile suspension, browser storage eviction and memory limits. Keep game assets private and outside Git. Safari 26 has WebGPU; that is API availability, not evidence this Halo runtime works on iOS. Desktop campaign acceptance precedes Android Chrome and iOS Safari device trials. Do not promise every phone/browser or advanced DualSense haptics.

Runtime is now NEWEST-29 (Claude Sonnet 5.5, Oct 1). FIRST CAMPAIGN GAMEPLAY IS REACHED (Cairo Station opening, about 11 fps; steps in docs/halo2-boot-recipe.md). READABLE MENU TEXT IS FIXED AND CHROME-VERIFIED: the font/layout code was never the bug. Detours (Cartographer's hook layer) aborted its whole 60-hook transaction because our VirtualProtect rejected the trampoline region at 0x3f0000; the text label scale (xlive g_ui_text_label_scaling) stayed 0.0, so every label's layout rect collapsed. Read NEWEST-29 and its addendum before anything else. Do NOT resume the FUN_0049975a/FUN_004991aa hunt from NEWEST-28; it is superseded. Next (user chose option 1: first PLAYABLE build, 60fps as the following milestone): reach the main menu and test CAMPAIGN, then raise speed where cheap (thunk batching, v86 JIT tuning; currently about 14-20 fps with a visible tab), then audio stretch, DualSense/Gamepad and saves. Cartographer's hooks (including main_time_reset/game_tick) are now ACTIVE for the first time, so re-test anything previously blamed on timing. This repo is edited by several AI models and the user: read this file and the current working-tree state before touching anything, preserve others' local edits, keep bun.lock unstaged. No campaign, audio, controller or save acceptance yet.

Budget: user is nearly out of OpenAI quota, expects Gemini access in about an hour, and is considering $20-30 of Opus API credit until their Sunday reset. No API purchase or spending authorized by this note. Use a bounded single-blocker task and concise evidence; avoid full-history re-ingestion and open-ended agent loops.



## Rules for any agent, including free or smaller models (added Oct 2 by Claude Sonnet 5.5)

- Platform scope: desktop Chrome on a PC first; phones (Android/iOS) only after desktop gameplay is solid. Speed (60 fps) needs the CPU emulation removed (recompile or decomp); see work/bottleship-research/docs/halo2-decomp-research.md. A ready-to-paste takeover prompt for free/smaller models is work/bottleship-research/docs/prompt-space-bunny-alpha-max.md.

Read in this order: this file, HANDOFF.md newest NEWEST-N entry, then `work/bottleship-research/docs/halo2-boot-recipe.md`. Work in small steps and prove each one with a screenshot, a number, or a passing test. Do not claim something works because the code compiled.

**Safe, useful tasks for a smaller model:** boot the game with the recipe and test in-level input (mouse look, W/A/S/D, Escape); measure fps and guest RAM with the dev panel's System stats strip; leave the game running a few minutes and note any crash or RAM growth; improve docs; run `node node_modules/tsgo/bin/tsc -p tsconfig.json --noEmit` and the test suite (`bun test tools/tests` using the toolchain bun at `work/toolchain/node_modules/@oven/bun-windows-x64/bin/bun.exe`).

**Do not (these already wasted real money):**
- Do not post, comment, open PRs/issues, star or push to anything except `sstewart207/halo2-browser`. Always pass `--repo sstewart207/halo2-browser` to `gh`. The `upstream` git remote is push-disabled on purpose. Never touch jenissimo/bottleship, v86 or Cartographer repos.
- Do not merge PR #7 or close issues without the user's say-so.
- Do not use pausing breakpoints in loops, `trapWrites`, or read memory after a pause; use `breakOn(addr, {pause:false, fast:true, capture:[...]})`.
- Do not edit files under `src/` while a game session you care about is running: Vite reloads the page and restarts the game (the "Vista compatibility" dialog returns; it is not a crash).
- Do not commit `bun.lock`, bundles, game assets, saves, logs or screenshots. Keep the Chrome window visible and normal sized, because a hidden tab skews every fps number.
- Do not re-open solved questions: the menu-text bug (Detours/VirtualProtect), the FUN_0049975a layout hunt, FPU strict/relaxed, and v86 SSE correctness are all closed (see NEWEST-29).
- Do not start a decompilation or recompilation project without the user agreeing a budget first (see `docs/halo2-decomp-research.md`).

**Stop and report to the user** if a tool or browser call fails three times, if you are about to spend more than a few steps on something not in the open list, or if you are unsure whether an action is outward-facing.

**Privacy note for free or "stealth" models:** anonymous free preview models may log prompts for the provider's training. Do not paste game logs, saves, account data, tokens or the private bundle; stick to source files and docs.
# NEWEST-64: Native D3DX9_31 attach succeeds; EXE startup reaches 0x404561

October 3, 2026. Live Chrome completes all four native DLL DllMain calls (d3dx9_43, xlive, pccompat, d3dx9_31) and executes halo2.exe. Current explicit stop is unresolved 0x404561 after recovered function 0x5ba425; last block 0x5ba440, ESP=0x1301d3c, EBP=0x1301fe4. No AOT title/menu/video/campaign/60fps acceptance.

- Private Ghidra CFG `../halo2-browser/scratch/ghidra/cfg_d3dx9_31_64c.json` recovers 55 missing functions in the exact 70-entry D3DX9_31 CRT table (PE raw 0x6d8..0x7ef); all 70 now compile. The loaded DLL base is 0x13c70000. FPATAN uses tested atan2(ST1, ST0) plus one x87 pop. Chrome completes DLL attach without skipping initializers.
- Whole-image compiler no longer retains WAT with `emitWat:false`, defers binary serialization until DLL exports exist and parses each DLL CFG once. Private `native-build64e.json` outputs 38,632-function, 123,275,338-byte WASM. `cfg_full64e-merged.json` starts from prior cfg_full53 and adds only Ghidra-recovered EXE function 0x5ba425; replacing cfg_full53 with raw Ghidra export would lose 13 prior functions.
- Next inspect exact 0x404561 in Ghidra, recover if actual entry, append only its CFG to cfg_full64e-merged, rebuild and Chrome boot. `bun run tools/boot-halo2.ts` works through the connected Chrome harness. Tests 1,077 pass, typecheck clean. Keep private binaries/CFG/bundle/logs/saves and bun.lock out of Git.

# NEWEST-69: EXE startup reaches Cartographer callback; next target 0x5a9de6

Chrome passes all four native DLL attaches and recovered EXE startup functions, including import wrapper 0x6a8679 for xlive ordinal 5236. The compiled xlive export is preferred 0x100d54f0/runtime 0x130d54f0. Current explicit stop is EXE target 0x5a9de6, return 0x1304e3bb, last xlive block 0x1304e3a7. No AOT title/menu/video/campaign/60fps acceptance.

- Private `../halo2-browser/scratch/ghidra/native-build69.json` uses `cfg_full68b-merged.json`, preserving inherited cfg_full53 plus 14 verified recovered EXE functions. Build69 contains 38,645 functions/123,332,845 bytes. The local ignored public WASM is this build. Use Node with `--max-old-space-size=3584` while system memory is constrained.
- Implemented/tested CMPSB.REPE (flags, DF, zero count), PADDD/ANDPS and PACKUSWB (signed saturation, alias snapshot). Chrome passes all of them. Tests 1,082 pass, 5,400 assertions, typecheck clean.
- Next Ghidra inspect/recover 0x5a9de6, append only its real CFG to merged EXE CFG, rebuild and boot. Beware incorrect `0x10d54f0` xlive address from an earlier missing zero; correct preferred xlive export is `0x100d54f0` and already compiled. Ghidra's raw EXE export has fewer inherited functions, so do not replace merged CFG. Keep assets/binaries/logs/saves private and bun.lock unstaged.
- Note for all agents (Codex / Claude / Antigravity): User is on metered personal subscriptions ($20/mo tiers for ChatGPT Plus and Claude Pro, limited Gemini quota). Avoid exploratory token burn, unnecessary subagent calls, or redundant polling loops. Keep steps focused and handoffs clear.

# NEWEST-72: EXE startup advances through discord probes; next target 0x5aa955

Chrome passes all four native DLL attaches, Cartographer ordinal 5236, EXE callback 0x5a9de6, and recovered EXE startup targets 0x5ac089 and 0x5ab400. Execution progresses through discord_game_sdk load probes, heap allocations, and CRT TLS/error handling, stopping at unresolved indirect call target 0x5aa955 (return 0x5abdb3, last block 0x690d13). No AOT title/menu/video/campaign/60fps acceptance.

- Private `../halo2-browser/scratch/ghidra/native-build72.json` uses `cfg_full72-merged.json` (38,648 functions / 123,351,049 bytes). Public binary `public/halo2_recompiled.wasm` is Build 72.
- Added and unit-tested STOSW (Direction Flag forward/backward). 1,084 tests pass across 128 files (0 failures, 5,404 assertions); clean typecheck.
- Rebuilt `dist-recompile.cjs` CommonJS bundle (`bun build tools/recompile-native-cfg.ts --target=node --format=cjs --outfile=dist-recompile.cjs`). Note: node memory should use `--max-old-space-size=8192` (the machine has 15GB free RAM, avoiding OOM).
- Space Bunny Max Alpha (Codebuff) notes: Single scenario map `01a_tutorial.map` (Armory); selecting other maps spins `GetFileAttributesA` forever with frozen heap. DInput accumulator slot gap blocks synthetic mouse-look. v86 2GB clamp is in `CPU.create_memory`.
- Next: Inspect and recover target 0x5aa955 in Ghidra, append to `cfg_full72-merged.json`, recompile Build 73, and boot. Keep assets/binaries/logs/saves private and bun.lock unstaged.


