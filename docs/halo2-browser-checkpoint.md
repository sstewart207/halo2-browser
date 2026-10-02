## October 1 product goal and next-agent handoff

User confirmed the long-term experience: open a private hosted URL on PC, Android or iPhone/iPad, load/download the game, and execute locally on that device. No streaming or remote execution. Support DualSense and other OS-recognized USB/Bluetooth controllers through the browser Gamepad API, translated into guest XInput. Add remapping, dead zones, disconnect/reconnect handling, and test wired/wireless separately on each target device. Local persistent campaign saves first; complete emulator snapshots and optional private cross-device save sync are separate later milestones.

Hosting must support HTTPS and cross-origin isolation (COOP/COEP) for SharedArrayBuffer. Cache downloaded files where supported; account for the first large download, user activation for audio, mobile suspension, browser storage eviction and memory limits. Keep game assets private and outside Git. Safari 26 has WebGPU; that is API availability, not evidence this Halo runtime works on iOS. Desktop campaign acceptance precedes Android Chrome and iOS Safari device trials. Do not promise every phone/browser or advanced DualSense haptics.

Runtime is now NEWEST-29 (Claude Sonnet 5.5, Oct 1). READABLE MENU TEXT IS FIXED AND CHROME-VERIFIED: the font/layout code was never the bug. Detours (Cartographer's hook layer) aborted its whole 60-hook transaction because our VirtualProtect rejected the trampoline region at 0x3f0000; the text label scale (xlive g_ui_text_label_scaling) stayed 0.0, so every label's layout rect collapsed. Read NEWEST-29 and its addendum before anything else. Do NOT resume the FUN_0049975a/FUN_004991aa hunt from NEWEST-28; it is superseded. Next (user chose option 1: first PLAYABLE build, 60fps as the following milestone): reach the main menu and test CAMPAIGN, then raise speed where cheap (thunk batching, v86 JIT tuning; currently about 14-20 fps with a visible tab), then audio stretch, DualSense/Gamepad and saves. Cartographer's hooks (including main_time_reset/game_tick) are now ACTIVE for the first time, so re-test anything previously blamed on timing. This repo is edited by several AI models and the user: read this file and the current working-tree state before touching anything, preserve others' local edits, keep bun.lock unstaged. No campaign, audio, controller or save acceptance yet.

Budget: user is nearly out of OpenAI quota, expects Gemini access in about an hour, and is considering $20-30 of Opus API credit until their Sunday reset. No API purchase or spending authorized by this note. Use a bounded single-blocker task and concise evidence; avoid full-history re-ingestion and open-ended agent loops.

# NEWEST-29: Menu text renders. Root cause was Detours aborting (VirtualProtect on a low-gap allocation)

October 1, Claude Sonnet 5.5 with the user. NOT committed or pushed; working tree only (src changes below + one new test). Verified in Chrome on a clean boot with NO manual pokes: "PRESS ANY KEY TO CONTINUE" is readable on the title, and the account panel shows ONLINE ACCOUNTS, its instruction text, and >Play Offline / Create Account / Add Account with A SELECT / B CANCEL prompts. TypeScript clean; 932 tests pass (929 + 3 new), 4792 assertions, 101 files. After choosing Play Offline the game returned to the title screen; the main menu and CAMPAIGN were NOT reached or verified.

## Root cause chain (evidence, so nobody redoes it)

1. At FUN_00630319 (c_text_widget render) the SSE sequence at 0x6305a2-0x6305c1 computes the layout rect bottom as (h / S + y2) - h with S read by `DIVSS xmm1,[mem]`. The operand is NOT the static [0xe3e424] (the game's 0.5): Cartographer patches it (`user_interface_text.cpp`: `WritePointer(GetAddress(0x2305AC)+4, &g_ui_text_label_scaling)`, same at 0x23066A) to its own float, which defaults to 0.0f. Live bytes at 0x6305ac are `f30f5e0d c8928d13` = operand 0x138d92c8, inside xlive.dll (base 0x13000000).
2. S = 0 -> divide gives inf -> CVTTSS2SI returns 0x80000000 -> `(short)` is 0, so rect bottom (and clip bottom/right) became 0. In FUN_0049975a the gate `COMISS bound,[esp+0x18]; JBE 0x499b8f` then skips every line, so FUN_004991aa is never called. That is the "layout never reaches the drawer" symptom from NEWEST-28.
3. Cartographer sets that float in its hook of update_screen_settings (`rasterizer_settings.cpp`, detour at RVA 0x264979 -> VA 0x664979): `set_ui_text_label_scale(ui_scale<=1 ? ui_scale : 1/ui_scale)`. That detour was never installed. Live bytes at 0x664979 were the original prologue (`f30f1044...`); none of ~10 sampled detour targets had a JMP.
4. Detours keeps `s_nPendingError` after a failed transaction. Read live at xlive RVA 0x2bea74 (VA 0x132bea74): it was 0x1e7 (487, ERROR_INVALID_ADDRESS). One failed DetourAttach makes DetourTransactionCommit abort ALL queued detours (all-or-nothing), silently.
5. DetourAttachEx probes the target with `VirtualProtect(target, n, PAGE_EXECUTE_READWRITE)` and returns GetLastError on failure; the trampoline region VirtualAlloc'd at hint 0x3f0000 (just below the 0x400000 image) is satisfied by the `isFreeLowGap` shortcut in `kernel32/memory.ts` VirtualAlloc, which tracks it in `virtualAllocRegions` but registers NO addressSpace region. `VirtualProtect` only consulted `addressSpace.getRegion()`, so it returned FALSE/487.

## Fix (src/worker/modules/kernel32/memory.ts)

`lowGapProtect` map records each low-gap allocation's current protection. `VirtualProtect`, when `addressSpace.getRegion()` is null but the range is inside a tracked low-gap VirtualAlloc root, writes the correct old protect, records the new one, applies page-table protection, and returns TRUE. Addresses that were never allocated still fail with 487. Regression test: `tools/tests/virtual-protect-low-gap.test.ts` (2 of its 3 tests fail with the fix disabled; confirmed). After the fix: pendingError = 0, bytes at 0x664979 start `e9 ...` (JMP into xlive), Cartographer's own label scale reads 0.5.

Live proof before the fix: poking 0.5 into 0x138d92c8 via `dbgCall('pokef32', ...)` made PRESS ANY KEY appear. That poke was a diagnostic, not the fix; no poke is needed now.

## Things that were NOT the cause (skip these)

FPU strict vs relaxed (same rect either way); v86 SSE instruction semantics (a standalone node test of the exact MOVSS/MOVAPS/SUBSS/DIVSS[mem]/ADDSS/CVTTSS2SI sequence returns 470 with JIT on and off on both public/v86.wasm and the vendor build; MXCSR 0x1f80; the hard-coded XMM offsets 824/832 in fpu-helper.ts are correct); DAT_00e3e424 itself (0.5 is correct; setting it to 1.0 doubles the logo); glyph cache/font files (already fine per NEWEST-27/28).

## New harness capability (src/worker/harness/eip-breaks.ts, cmds/breakpoints.ts)

`breakOn(addr, {pause:false, fast:true, capture:[...]})`: each capture is read INSIDE the hit handler, so bytes belong to the exact hit instant. Forms: `{ptrArg:i, len, off?}` (deref [ESP+4+i*4]), `{esp:n, len}` (ESP+n locals beyond the fixed +60 window), `{addr:A, len}` (a global), `{simd:true, len:1}` (MXCSR + XMM0-7, 132 bytes, simdSnapshot layout). The result is `hit.capture[]` with `{label, addr, hex}`.

## Tooling lessons (these cost hours)

- A "paused" guest is NOT frozen at the breakpoint. After a `pause:true` hit, `report().cpu` shows an unrelated EIP/ESP, and memory read after the hit mixes later frames (stack/heap locals read stale or zero). Use the snapshot `stack` (ESP-8..ESP+60) or the new `capture` option. Do not trust post-hit `readBytes` of stack locals.
- Repeated pause/resume cycles eventually make the game's crash reporter fire. `trapWrites` watch mode crashed the worker once with `RangeError: Maximum call stack size exceeded`; avoid it on the hot stack.
- Interior (mid-block) EIP breakpoints do not hit; block starts do (function entry, call return address, branch targets). Counting hits with `breakOn(..., {continuous:true})` then `breaks` works for call-graph funnels.
- `harness.rpc('events', n, 'apiBreak')` is capped at 256 events (EVENT_RING_CAP in event-bus.ts); boot-time API sequences rotate out. Raise the cap temporarily to inspect boot (it is back at 256 now).
- Boot flow in Chrome: navigate `?game=dev`, wait for the page, `harness.openWgb(<bundle path>,{reload:false})`, wait for the Halo launcher dialog (tab title flips from "BottleShip" to "Halo2 - BottleShip"), click Run. Clicking Run before the dialog exists can leave the CPU at the reset vector (eip 0xffff0); just openWgb and Run again. The title is up about 40-50 s after Run. Extension evals are capped at about 45 s.
- `harness.rpc('key',[13])` may not register; `keyHold` with 500 ms did.
- Vite died once during this work; restart with the toolchain bun: `bun.exe --bun node_modules/vite/bin/vite.js` from work/bottleship-research (bun/bunx are not on this shell's PATH).
- Ghidra helper added: `work/halo2-browser/scratch/ghidra/DisasmRange.java <start> <end> <out>` (headless disassembly list). xlive.dll can be disassembled with `tools/pe-disas.py range "C:/Games/Halo 2 Project Cartographer/xlive.dll" <VA> <n>` (ImageBase 0x10000000; live base 0x13000000). Detours inside xlive: DetourAttachEx about RVA 0x163c70, DetourTransactionCommitEx RVA 0x164210, DetourUpdateThread RVA 0x164680; globals at RVA 0x2bea70 threadId, +4 pendingError, +8 failedPtr, +0xc pendingThreads, +0x10 pendingOps.

## Still open / next

1. Get past Play Offline to the main menu; verify CAMPAIGN is visible, keyboard navigation, then campaign start (the real campaign acceptance).
2. Frame rate: user goal is a first playable 60fps build. MEASURED (title/account screen, JIT on, Chrome, 800x600): about 9 fps = 109 ms/frame, split v86 guest CPU 76 ms, API thunks 31 ms, GPU 0.2 ms, present 0.4 ms (perfProfile enable + perfStats). A 600-sample guest-EIP histogram is flat (top region under 7%: halo2 +0xc33xx, +0x1145xx, +0x1358xx, xlive +0x541xx), so there is no spin loop or single hot function; this is raw emulation cost. Even zero thunk cost would only reach about 13 fps, and gameplay will be heavier. 60fps is about 6-7x away; realistic levers are thunk batching (31 ms), v86 JIT tuning, or ahead-of-time translation of hot guest code to WASM.
3. Intro audio plays time-stretched (user re-confirmed, heard not seen); likely tied to emulation speed or audio pump pacing; unverified.
4. DualSense/Gamepad -> XInput and saves: untouched.
5. Any earlier theory that blamed Cartographer behavior on a "missing" feature should be re-tested now that its 60 detours actually apply; new breakage is possible.
6. Owed: nothing staged or committed; PR7/issue1 not updated for NEWEST-29; README not updated.

## Same-session addendum (Claude Sonnet 5.5): dev stats panel, corrected fps, navigation, the "Vista screen"

- NEW DEV PANEL: `src/app/DevStatsPanel.tsx` (+ `.module.css`), mounted at the bottom of `DevPanel`. Collapsible "System stats" strip: GPU (WebGPU adapter info via `getWebGPUAdapterInfo()` in `src/browser-support.ts`), FPS (D3D9 device counters: fps / frame / draws), Guest RAM (live bytes across MemoryManager buckets vs configured RAM), Browser JS heap (Chrome `performance.memory` only), VRAM textures (ESTIMATE of GPU texture bytes; WebGPU exposes no real VRAM and buffers/render targets are not counted) and VRAM emulated (the size the emulator reports to the guest). Backed by one cheap worker message `dev_stats` in `src/worker/worker-handlers/debug-monitor.ts`. It polls at 1 Hz only while expanded; open state is remembered in localStorage (try/catch). Live reading on the account menu: GPU nvidia / blackwell, FPS 20 (frame 8518, 331 draws), Guest RAM 822 MB live of 2.00 GB.
- FPS CORRECTION: the earlier "about 9 fps" was measured while the Chrome tab was HIDDEN (`document.visibilityState === "hidden"`, window collapsed to 159x27). With the tab visible: title screen 14.5 fps (69 ms/frame: v86 guest CPU 45.5 ms, API thunks 22.4 ms, GPU 0.2 ms, present 0.3 ms); account menu about 20 fps. 60 fps is roughly 3-4x away. ALWAYS measure with the tab visible and focused; a hidden tab also makes Chrome screenshots time out and can skew pacing. The 600-sample guest-EIP profile is flat (no spin loop or single hot function), so more speed means thunk batching, JIT tuning, or ahead-of-time translation of hot guest code to WASM.
- Menu path reached (keyboard via `harness.rpc('keyHold',[vk,ms])`, Enter=13 for 500 ms, Down=40, Escape=27): title -> Enter -> ONLINE ACCOUNTS -> Play Offline -> back to title with "Status: Locally signed in" -> Enter -> CHOOSE PLAYER (Create New Player / Default). Choosing the first entry opens the profile-name virtual keyboard. The main menu and campaign were NOT reached yet.
- "WHY IT KEEPS SHOWING A WINDOWS VISTA SCREEN": it is not a crash. "Halo 2 for Windows Vista has one or more compatibility issues on this computer / This computer's performance information has not been created" is the game's own startup check; the emulated Windows has no Windows Experience Index data, so it asks on EVERY boot. Click Run to proceed. It reappears whenever the guest restarts, and every Vite hot-reload (any edit under src/ while the page is open) restarts the whole game, which looks like a crash. The real crash window ("Crash Report for Halo 2: Project Cartographer") appeared only after repeated pause/resume debugging. Possible follow-up: make the emulated OS report a performance rating, or pre-set the dialog's "Don't show this message again" so the bundle skips it.
- Harness notes: `harness.rpc('shot')` returned a blank white image here; use Chrome screenshots with the tab visible. The log server (`bun run tools/log-server/log-server.ts`, port 3001) must be running for debug_png_dump / write_file_b64; it died once and was restarted.

## MILESTONE (same session, later): FIRST CAMPAIGN GAMEPLAY REACHED

Oct 1 2026, Claude Sonnet 5.5. Using the keyboard only, the game went title -> ONLINE ACCOUNTS -> Play Offline -> CAMPAIGN OPTIONS -> SELECT LEVEL (all missions listed, readable) -> CHOOSE DIFFICULTY -> Cairo Station loaded and is running: dark cryo room with a red light, tutorial prompt "Move the Mouse to look up", HUD with shield bar, motion tracker and ammo counters. About 11 fps in-level (menus 19-35 fps, title 10-15 fps). Guest RAM 746 MB live of 2 GB. No crash during load. Exact steps, waits and the scripted Run click are in `docs/halo2-boot-recipe.md` (repo) so the next agent can reproduce this in about 10 calls.

NOT verified (do not claim): mouse-look and movement actually responding, audio correctness (user still hears stretched intro audio), saves, controller input, anything past the tutorial start, stability over minutes. Rendering of the first room looks plausible but was a single screenshot.

Next, in order: (1) confirm input in the level (inject mouse movement and a W key hold, watch the HUD/view change); (2) leave it running a few minutes and watch for crashes or the guest RAM climbing (earlier builds wedged near 1.7 GB heap); (3) speed (issue #8) and audio stretch (issue #9). Re-test timing assumptions: Cartographer's frame/time hooks are active for the first time.

# NEWEST-28: Validation passes; readable game labels still blocked

October 1. Strict font/menu sprint. Validation: 929 tests pass, 4782 assertions across 100 files; TypeScript clean. Guarded pixel backing and block count now match at 1 MiB (32768 x 32 bytes); original 512 entry limits preserved. Chrome boots the real animated title and Enter advances into the account/menu panels. PRESS ANY KEY and menu labels remain visually absent. Do not claim readable menus or campaign acceptance.

Live, unpaused fast traces at 0x48dcd0 show nonzero glyph-record pointers for every character of PRESS ANY KEY TO CONTINUE (physical Font 2), and account-menu strings in physical Font 1/2. At widget gate 0x63074a, FUN_00499d59 returns AL=1 for sampled menu widgets. The cache/pre-validation blocker has therefore been advanced past. After changing screens, some unused title glyph handles can become -1 again; this alone does not prove starvation. Logical font 7 maps to physical font 1.

Important correction: 0x67110b emitter hits seen earlier include the working Cartographer header (physical Font 0). Do not treat these as proof that game labels emit quads. FUN_004991aa entry traces sampled only the three header layouts, while FUN_0049975a at 0x4997ff receives both game/header strings and returns AL=1 from its parser. FUN_0067186d at 0x6718c2 also passes its font-loading check for game/header. Converted game UTF32 buffer at 0x12fd950 contained ONLINE ACCOUNTS correctly. Thus the next focused question is why game-label layout in FUN_0049975a fails to call FUN_004991aa despite these successful gates. Investigate line/bounds and parser-loop state, not file loading, generic RAM or shader history.

Diagnostic details: harness fault snapshots now include ESP-8 through ESP+60 (bounded), enough to inspect layout locals. The default WASM dump cap is 4000; exhausted traces stop producing events even with breakpoints armed. dbgCall('maxDumps',1000000) was used temporarily; all breakpoints cleared and JIT restored with dbgCall('jitOn'). Some interior layout/flush breakpoints still produced no hits while known call-return breakpoints worked; no-hit traces are not proof a function never runs. A guarded temporary NOP of the line clipping JBE at 0x499a1c did NOT produce readable title text; original 8 bytes 0f866d0100008b84 restored and read back. This experiment is NOT included in source and is inconclusive.

Supported Chrome extension debugging only; port9333 is unavailable. Fresh tab at http://localhost:5174/?game=dev, private halo2-2gb.wgb loaded with harness.openWgb(...,{reload:false}); native Run button clicked. Keep this debug tab for continuation. No security settings changed. Keep bun.lock unstaged, game assets/bundles/logs/screenshots private. CLI probe-prank was not rerun because9333 is unavailable; equivalent guest reads and live traces used through extension CDP.

README on GitHub default main was actually refreshed in docs-only commit 702633e; implementation remains on codex/halo2-browser-checkpoint / PR7. PR7 and issue1 stay open. Latest screenshot is private logs/debug/newest28-menu.png. No campaign/audio/controller/saves acceptance. Scope remains font/menu only.

# NEWEST-27: Glyph-cache starvation fixed; label pixels still under verification

October1. Scope is exclusively font cache/menu rendering under strict quota. Guarded source patch in src/worker/core/halo2-font-cache.ts is called immediately after PE sections load. It validates original PUSH-immediate bytes at RVAs8d8b0,8d8c9,8d8eb,8d8f2 before any write, and only runs for halo2.exe. Enlarges actual backing DAT8c1928 to512KiB and DAT8c1924 block capacity to16384*32; preserves both original512-entry limits (125entries previously active). Byte count derives from block count to prevent mismatch. Disk assets/bundle unchanged. Targeted tests reject unknown builds/partial patches, verify backing/block consistency.929tests pass,4782assertions100files; TypeScript clean; bun.lock untouched.

LIVE VERIFIED: final corrected boot in Chrome tab1897426364 through extension. All Font2 characters in PRESS ANY KEY have +2c !=ffffffff: P=ef95002f,R=ef960030,A=ef970031,N=ef670001,K=ef980032; E/S/space/Y also valid. Original npx tsx tools/probe-prank.ts ran on earlier CDP9333 boot; final boot checked same structs via harness readBytes, because debugging Chrome exited and9333 is now unavailable. Chrome was reopened by user; no security changes. Title screenshot still has NO visible PRESS ANY KEY. Cache handles are fixed, but do not equate this with rendered labels. Enter keyHold13/500 sent; menu screenshot check pending at this interim checkpoint. Current next check: whether CAMPAIGN/NETWORK visible, then follow remaining pre-validation/cache readiness/atlas draw gate if absent. Do not re-derive file loading/root cause history.

TRIALS: first larger table configuration had initialization failure; original512 entries retained. During512KiB edit a text replacement temporarily produced256KiB backing with512KiB block count. Consistency test caught it; corrected before commit, final live boot matching512KiB verified. No claim that the earlier trial screenshot showed labels. Browser endpoint disappeared; shell Chrome relaunch was blocked by automatic approval review, user reopened Chrome. Use supported extension CDP, no bypass. tools/snap.ts now brings target to front and allows15sec screenshots (4sec calls timed out for minimized Chrome); tools/boot-halo2.ts enables bounded log buffer/streaming.

README rewritten around verified title/menu-panel achievements, remaining readable-label blocker and campaign-first goal. PR7 and issue1 track unfinished menu acceptance. No campaign/audio/controller/saves acceptance. Keep runtime evidence/snapshots/assets private and outsideGit.

# NEWEST-22: REAL HALO TITLE SCREEN IN CHROME - paused for Antigravity handoff

October 1. USER REQUESTED WRAP/PAUSE at 3 percent usage; do not continue development until resumed. Handoff to Antigravity Gemini 3.8 Flash. Previous pushed commit5caaf59; this checkpoint commits shader-reader and viewport fixes.

BREAKTHROUGH: actual game viewport now visibly shows animated HALO 2 title/background. No diagnostic preview overlay or streaming. Enter keyHold(13,450) transitioned to a real menu panel, but labels/text were absent. Campaign/gameplay/audio/controller/saving remain unverified. Current fresh boot after viewport fixes is running at title screen. Chrome tab1897425369 localhost5174/?game=dev preserved. Private visible Chrome screenshot logs/debug/halo2-visible-title-chrome.png. IMPORTANT: harness shot() PNG was black due capture/alpha path, even though Chrome screenshot visibly shows pixels; do not confuse that saved shot with failed presentation.

Root cause: D3D9Device.readShaderTokens scanned every DWORD for low16==FFFF, including comment/immediate payload. Halo final gamma PS7 was ps2.0 with ZERO parsed instructions; UI PS2 also zero. New instruction-aware shader/read-tokens.ts skips comments and operand payloads, handles SM1 widths/PS1.4 phase, rejects truncated bytecode. Chrome now gamma PS7 has ten instructions (tex/log/mul/exp/add/mov), UI PS2 fifty-one; no preserved pipeline errors/creation failures sampled. Backbuffer nonBlackPct~100, max255, averageBGRA~32/21/17/0. Visible alphaMode opaque renders correctly. No fake title/menu.

Viewport fix: SetRenderTarget0 resets to full target; SetViewport sanitizes against current target dimensions instead of previous viewport, which had shrunk to240x180 and prevented larger restore. Microsoft SetRenderTarget documentation confirms viewport reset. Live newest pass viewport800x600, frame271,322draws,152commands,no pipeline errors. Tests920pass/0fail/4740assertions97files; TypeScript clean. Keep bun.lock unstaged.

Next focused task: diagnose missing menu text. Read native shader/vertex declaration/texture source and input polling, not fabricated fonts/metadata. UI last BB pass VS351/PS2/decl14/FVF322/strip5,stride20,texture836; first vertex x1028.8,y25,z~1023 (float interpreting packed color yields null/NaN). Need actual declaration + VSconstants before assuming screen coordinates; stride20 is not arbitrary XYZ. Trace UI glyph texture updates/format/samplers and proper shader semantics. Confirm menu labels and input, then actual campaign play. Don't rewrite in Rust, raise RAM, fake success or use streaming.

Ghidra installed DLL analysis COMPLETE private scratch/ghidra/proj halo2, xlive.dll imagebase10000000. xlive-final-pass.txt FUN10052a10 verified gamma pass, xlive-presentation-flow.txt primary->resolved copy, xlive-final-targets.txt helpers;52e00 callback not recognized as function by automatic analysis. Installed assets unchanged. User independently disabled Defender; normal DLL copy succeeded; Codex changed no security settings. No assets/bundles/saves/logs committed.

Browser recipe: existing harness/CDP; boot private halo2-2gb.wgb via /__wgb. rpc dialogs confirms Run cx483cy399,clickAt. rpc keyHold([13,450]) to advance. rpc rtDebug reports backBufferPasses, pipelineErrors; d3d9TexturePixels([0]) actual BB. Logs containNUL. Use Chrome supported browser tooling, no shell UI automation. Preserve preexisting edits/contributor work. Development is PAUSED for handoff, not complete.

# NEWEST-21: Indexed strips render; installed Cartographer final pass identified

October 1. Development active. Stable backbuffer ownership, two programmable MRT outputs and faithful Present bindings pushed as da07b62 to PRIVATE origin. Indexed strips now expand 16/32-bit guest indices into pooled uint32 triangle lists, preserving winding, degenerate triangles and legal index 0xffff. Module propagates backend HRESULT. Backbuffer diagnostics retain distinct shader/primitive passes, constants, viewport, texture index and unaligned-safe vertex floats. 915 tests pass, 4731 assertions, 96 files; TypeScript clean. Preserve pre-existing bun.lock.

Chrome with strips: frame179/180,470-475 draws,149 commands, no preserved pipeline errors. Actual 800x600 backbuffer readback is still all zero; viewport BLACK. Prior RGB-only diagnostic preview verified real textured geometry and blue effects in scene targets, NOT working native presentation/menu. Backbuffer receives UP fan/strip draws, so no-draw explanation is excluded. Later last BB draw was VS351/PS2, zero PS instructions, viewport240x180, stride20, first vertex x1028.8: likely later UI; distinct-pass diagnostics added to capture final full-screen pass next.

User independently turned Defender off and explicitly authorized proceeding. Installed xlive.dll is available again; normal copy to private scratch succeeded. Ghidra imported/analyzed it successfully. Private xlive-presentation-flow.txt identifies xlive+56afd as primary->resolved scene StretchRect in FUN_10056a60; final call FUN_10052a10 is actual gamma/brightness pass. It gets backbuffer, either copies directly when brightness/gamma default or binds a screen shader, PSconstant0 and draws via halo2+27d4ef; output callback LAB_10052e00. This supersedes failed DLL-copy state in NEWEST20. Security settings were not changed by Codex. No binaries/assets/logs published.

Next: Chrome current fresh boot contains distinct backBufferPasses diagnostics. Confirm Run control via rpc dialogs, click; inspect rtDebug.backBufferPasses and real backbuffer pixels. Inspect zero-instruction PS if relevant full-screen pass also uses it. Menu/campaign/audio/controller/saves still unverified. Continue investigation after checkpoint, do not pause.

# NEWEST-20: Stable backbuffer, two programmable MRT attachments, faithful Present state

October1. Active continuation; user explicitly says keep working and update GitHub/docs. Last pushed bcaa2a7. New changes local pending commit: swap chain owns a stable GetBackBuffer surface and each query adds caller ref; Reset clears it. Real second MRT color attachment and oC1 fragment output; own target refs, per-target write masks, MRT-aware pipeline cache identity, shader binding feedback checks. Advertised NumSimultaneousRTs is2, matching implemented programmable path. Slots2/3 non-null remain unsupported; do not claim full FFP MRT or all texture format/depth correctness. Present flushes current targets, presents actual backbuffer, then restores guest binding state (old code silently changed active target to default).

912tests pass,4723assertions95files; typecheck clean. Tests cover cached swapchain caller refs, primary/secondary separation, GetRTownership, MRTWGSLoutput and caps. Live Chrome stable-surface and first MRT runs had no new preserved shader/pipeline errors and no worker GPU errors sampled, but displayed viewport/backbuffer still black. GetBackBuffer identity fix alone did NOT solve black. Root NEWEST19 explains verified textured geometry/blue particles in offscreen scene targets. No menu/campaign accepted. Live draw histogram confirms indexed triangle strips are skipped: indexed:5:RT=10393 versus indexed:4:RT=173197. Backbuffer DOES receive supported UPfan6 and UPstrip5 calls (754/44059); not simply no backbuffer draws. Current frame876/877,370-392draws149commands,no shader errors. Next implement observed indexed strips and trace final-pass output. Late per-target write-mask refinement not separately booted yet (maskdefaultsallF).

Diagnostics: rtDebug.upDraws last16 calls plus drawTypes counters. PreviousUP hadrt19/VS345/PS1673/decl3/FVF322/fan6 count2 stride24 constants[1,1,1,1]. DrawIndexedPrimitiveUP census empty (not an observed missing call). Original source Cartographer fullscreen gamma path differs from Ghidra actual address26c5e2, which resolves to FUN_0066c3eb blur/effects, so do NOT equate source patch RVAs to unrelated functions without verifying installed build. Ghidra gamma-flow.txt and presentation-flow.txt private outputs. Attempt to Copy-Item installed xlive.dll for Ghidra was blocked by Defender as virus/PUA; no security change or alternate extraction attempted. Continue existing analysis/browser traces; don't bypass that block. New xlive headless import failed because copy failed, not a completed DLL analysis.

# NEWEST-19: Real Halo scene pixels in GPU targets; presentation still black

October 1. Keep developing. Pushed shader/stream checkpoint 0f1a625 to PRIVATE origin; PR7/issue1 updated. New local render-target changes: GetRenderTarget returns real owned current surface (implicit backbuffer via GetBackBuffer), primary bound surface retained, disabling a secondary slot no longer switches slot0; unsupported additional color attachments return NOTAVAILABLE. 909 tests pass,4709assertions95files; typecheck clean. Preserve bun.lock.

Chrome after render-target restoration: frame366/367,278-286draws149commands, no original pipeline errors. Actual viewport remains BLACK, menu/play unaccepted. IMPORTANT PROGRESS: authoritative GPU scene target readback is now nonuniform, max255, average BGRA around25..54 and original alpha0. Diagnostic RGB PNG preview (forces alpha255 only for visualization, does NOT alter game texture) shows textured gray/brown geometry and blue particle effects. This is real game-rendered scene data, not a successful presented menu. Source135161728 and copied destination154151880/435377248 at that run have identical content. Actual backbuffer readback ptr0: 800x600,100% black, max0. Thus trace final fullscreen/backbuffer pass rather than claiming all rendering is blank.

New diagnostic d3d9TexturePixels(ptr,preview?) accepts0 for backbuffer and optionally returns private data-URL PNG; do not log/publish large data or game images. rtDebug adds recent UP draw metadata to identify final PS/VS/FVF/target/constants. Final pass Cartographer source rasterizer_dx9_fullscreen_passes.cpp rasterizer_dx9_apply_gamma_and_brightness: gets real backbuffer, direct StretchRect only if brightness0/gamma1, otherwise samples scene texture with screen-effect shader3 into backbuffer. Need trace that pass. One-shot first calls: DrawPrimitive trianglelist4, DrawIndexedPrimitive4, DrawPrimitiveUP trianglefan6. No proof strip omission is final blocker. Current Chrome1897425369 clean boot awaits Run and draw diagnostics. Root legacy entries are history.

# NEWEST-18: Original GPU shader failures isolated; semantic and vertex-stream fixes under live test

Live verification after multi-stream fix: frame431/432, draws272-278,149commands; rtDebug.pipelineErrors=[] and no WebGPU errors in worker log sample. Actual viewport still black. Current live StretchRect source135161760 and destination435377352 both800x600 bgra8unorm,100% non-black, average native BGRA[35,35,35,0], max35: uniform clear gray, NOT scene graphics. Next trace backbuffer/presentation and rendering state. Both original semantic and stride-layout rejection classes removed. Commit this verified chunk; do not include bun.lock.

October 1. Development remains active at user request. Last pushed commit ad66601; new changes are local until live verification. Preserve pre-existing bun.lock. No menu/gameplay accepted; viewport still black.

Worker WebGPU errors were missed by page-console diagnostics. Added rtDebug.pipelineErrors (first 40 unique original shader/pipeline errors) and d3d9TexturePixels(ptr) GPU readback statistics. Original errors: PS input register v3 emitted in.col3 despite only COLOR0/1 fields; secondary output oC1 referenced without declaration. Shader Model 3 declaration semantics now map arbitrary register numbers to position/color/texcoord semantic IR; COLOROUT temporaries are declared. Packed semantics currently explicitly unsupported rather than silently overwritten. MRT outputs still not implemented.

Clean Chrome boot after semantic fix: these shader errors disappeared, revealing pipeline attribute size16 > stream0 stride12. Halo uses multiple vertex streams; device previously ignored SetStreamSource >0, linker excluded other-stream declaration elements and substituted float4 input in stream0. Local new fix retains independent stream bindings, uploads/binds used streams, links per-stream layouts, adds all stream strides to cache identity, disables arena/last-resolve shortcuts for multi-stream identities, clears extra bindings on Reset. Live verification underway on Chrome1897425369 localhost5174. 907 tests pass, 4699 assertions /95 files; typecheck clean. Prior single-stream boot ~741 draws/152 commands per frame still black. Pointer reuse means historical copy handles must be re-read before GPU texture sampling.

Next: inspect original pipelineErrors after multi-stream boot, actual viewport and current live render-target pixel stats. State-block handling/GetStreamSource, MRT, GetRenderTarget restoration remain compatibility gaps; do not claim entire D3D9 stream API complete. No RAM increase, security changes or assets published.

# October 1: honest video failure, texture transfers and real GPU surface copies

Halo now continues beyond the native MF.dll proxy trap through its normal unavailable-video error path. Frames advance with approximately 420-470 draws and 149 commands per frame. **The actual game viewport remains black: no menu or gameplay is accepted.**

- MF/mfplat imports resolve to explicit E_NOTIMPL HRESULTs until the session/topology/event backend exists. Factory outputs are cleared and stdcall ABI is correct. This is unsupported-feature reporting, not implemented intro playback.
- UpdateTexture copies matching mip-chain tails for 2D/cube/volume native pixels and marks destination uploads dirty. GetTexture returns the bound COM pointer with caller ownership; AddDirtyRect validates regions. Autogenerated mip updates remain unsupported.
- StretchRect now submits pending draws and performs real GPU scale/filter copies of color surfaces. Backbuffer surfaces carry metadata, and its GPU texture supports copy destination/sampling. Depth copies and same-GPU-texture copies remain unsupported.
- Vertex/pixel float constant queries return exact native bits, replacing success without output. Surface-copy diagnostics are available through rtDebug().
- Live Chrome GPU probe: a 2x2 source scaled to 4x4 returns the exact red/green/blue/white corner pixels with no validation errors.
- Separate local browser-worker probe of the user's actual intro_60.wmv: WMV3, 1280x720, ~29.97fps, 120 frames decoded, all 120 contain non-black pixels. Decoder reports no audio stream; audio is not validated. This proves the installed decoder can decode the video, not that Halo's Media Foundation integration is done.

Validation: 903 tests pass, 0 fail, 4680 assertions across 95 files; typecheck and diff check pass. Private WMV probe assets, binaries, logs and bundles stay ignored. Latest root HANDOFF/AGENTS checkpoint is NEWEST-16; development continues. Previous resource/volume fixes are pushed as aa4f159. New shader-query/copy-diagnostics boot verification is in progress.
# October 1 checkpoint: resource lifetime and volume texture startup fixes

Live Chrome execution, with the same private 2GB bundle, now reaches the Windows Media Foundation intro-video path. It still renders black. No menu, video, campaign gameplay, correct audio, controller input or saving is accepted.

- Real D3D9 resource AddRef/Release replaces dummy return values in both slow and fast dispatch paths. Texture surfaces, device bindings and state blocks retain owners; final release frees CPU/GPU backing. Live guest memory fell from 1741 MB to roughly 750 MB without enlarging RAM.
- Wait APIs honor persisted termination on reaped thread handles. Halo passes its former renderer-thread wait.
- StrStrIA returns actual match pointers/NULL instead of falsely identifying the adapter as AMD.
- Missing CreateVolumeTexture caused hundreds of thousands of failed bitmap-loading calls and repeated renderer resets. Volume COM interfaces, full native mip/slice backing, box locks, child references, real WebGPU 3D uploads and matching shader/layout coordinates are implemented.
- Latest Chrome sample: 762.13 MB live, 756.32 MB tracked, peak 762.19 MB. No continued renderer-reset entry hits at the subsequent video startup stop.
- Current stop: Media Foundation MFCreateMediaSession; MFStartup is unimplemented. The intro path needs real local decode/render. UpdateTexture/GetTexture/StretchRect remain observed graphics gaps, so video is not the only possible cause of black output.

Validation: 895 tests passed, 0 failed, 4615 assertions across 93 files; TypeScript and diff checks clean. Volume tests cover mip/slice pitches, bounds, native descriptors/ABI, compressed locks, readonly behavior, slice pixel conversion and 3D shader coordinates. These are compatibility tests, not gameplay acceptance.

Private runtime logs, captures, game executables/DLLs, maps, profiles, saves and bundles remain excluded from Git. The installed game and Defender settings are unchanged. Workspace HANDOFF.md NEWEST-15 contains the precise runtime addresses and local Ghidra evidence. An interior fast breakpoint with zero hits is not proof its branch is unused: tracing the reset function entry confirmed the bitmap caller.

---

# Latest paused checkpoint: PAUSED; compiler OOM traced to rejected HeapAlloc(0)

September 30, 2026, late evening. User explicitly requested pause and handoff to GLM 5.3. STOP development until the user or their chosen agent resumes it. This supersedes NEWEST-5's active-development instruction. No implementation changes were made after bb6a256; this checkpoint documents a newly isolated cause. Halo menu/video/gameplay remains unverified.

## Newly confirmed evidence

The compiler's initial allocator setup, HeapCreate, shader-model setup and later front-end setup all succeed. Non-pausing Chrome trace then isolates this sequence in the installed native d3dcompiler_43.dll:

1. Routine RVA d8c10 calls its DWORD-array allocator at RVA e3080 three times. The first requested element count is 24 (96 bytes), the second is 4 (16 bytes); both return non-null allocations.
2. The third call, at RVA d8d91, passes ESI=0 elements. RVA e3080 multiplies ESI by four and calls imported kernel32!HeapAlloc with dwBytes=0.
3. At RVA e30c1, immediately after HeapAlloc, EAX=0. Caller return point RVA d8d96 also records EAX=0, ESI=0. The caller tests the pointer and takes its OOM path at RVA d8d2f..d8d40, which returns 0x8007000e. The next recorded return at RVA d7cbd is EAX=0x8007000e. No fabricated allocation or shader substitution was used.
4. Read-only source review confirms both JS HeapAlloc implementations explicitly reject dwBytes===0 and set OOM. The inline guest stub routes zero bytes to the trap; v86 Rust hypercall also routes zero to JS (comment currently says JS sets ERROR_NOT_ENOUGH_MEMORY). Thus this failure is expected from current emulator code.
5. A small native Windows ctypes control experiment called process-heap HeapAlloc for 0, 1 and 16 bytes and freed every result. All returned non-null; HeapSize reported 0, 1, 16 respectively. Native zero-byte allocation is a valid freeable block. No game install or security setting was changed.

This establishes the reproduced OOM's immediate cause: the emulator rejects a valid zero-byte heap allocation required by the compiler. Fixing it has NOT been attempted, and shader success/menu cannot yet be claimed. Later blockers may appear after the real fix.

## Concrete next work for GLM

- Read root AGENTS.md and this handoff. Work only in work/bottleship-research. Resume only under user authorization.
- Implement generic zero-byte HeapAlloc semantics in src/worker/modules/kernel32/memory.ts, both normal export (~line1289) and registered JS fast path (~line2641). Return a real unique freeable allocation with suitable alignment instead of NULL/OOM. Preserve nonzero allocation behavior and HEAP_ZERO_MEMORY. Consider whether existing HeapSize metadata can represent requested size 0 separately from physical capacity; do not invent a pointer or break freeing.
- Inspect src/worker/modules/kernel32/heap-slab-stubs.ts (~line78) and vendor/v86/src/rust/cpu/hypercall.rs (~line2169). They currently defer zero-size to JS, so a full v86 rebuild should not be needed just to make zero-byte allocations work. Update stale comments if appropriate; do not change compiled WASM casually.
- Add focused regression checks exercising BOTH normal HeapAlloc and fast path: zero-byte allocation succeeds, two simultaneously live results are distinct, HeapFree works, nonzero and zero-memory behavior are preserved. Avoid tests that merely check source strings.
- Typecheck/test, then fresh Chrome fixture boot and actual native compilation. Use continuous:true,pause:false,fast:true breakpoints. Resolve module bases. Prove D3DCompile result and shader buffer; then inspect actual rendered output. Passing tests is not menu/gameplay acceptance.

## Private trace and exact locations

Full bounded CPU/stack trace: work/halo2-browser/native43-zero-allocation-trace.json (private, outside Git). Observed native compiler base 0x14400000, so entry e3080=0x144e3080, after HeapAlloc e30c1=0x144e30c1, failing caller d8d96=0x144d8d96. Bases may move. Earlier successful stages: d83f6 HeapCreate->0x1234567e; d84be->0, d8709->0, d8759->0; d87f8->0x8007000e. Final trace contains exact count/return snapshots.

Newest fixture is unchanged: work/halo2-browser/bundles/halo2-native-d3dx43.wgb, 671387462 bytes. Native DLL preferences d3dx9_31.dll,d3dx9_43.dll,d3dcompiler_43.dll. Vite5174/log3001 remain running. Chrome browser3/tab1897424839 currently exited after the failing trace; no guest gameplay is running. Fast non-pausing trace points remain armed in the stopped worker; reload clears them. Use normal supported Chrome tools, no shell UI automation or security bypasses. Existing prior checkpoint validation remains 10 tests/74 assertions, TypeScript/build passed; there was no new code or test run in this tracing-only continuation.

User is handing off to GLM 5.3. No agent message was sent and no new chat was created. Preserve unrelated bun.lock/generated/index line-ending changes. Root is not Git. Git checkpoint bb6a256 is privately pushed; draft PR7/main-menu issue1 remain open. Commit/push this documentation separately, exclude raw trace/logs/bundles and preserve contributor credits.

---

# Latest verified checkpoint: correct native shader compiler loads; D3DCompile returns E_OUTOFMEMORY

September 30, 2026, late evening. Development remains resumed. This section supersedes NEWEST-4's shader diagnosis. No menu, video, campaign, audio, controls, saving or DualSense acceptance yet. Multiplayer deferred. Local browser execution only.

## Verified correction and progress

- NEWEST-4 incorrectly attributed D3DERR_INVALIDCALL to native d3dx9_31.dll. Its Halo import was native, but Cartographer patches the graphics path: the actual failing call came from xlive.dll+0x57e4e into the HLE d3dx9_43 compiler. API breakpoint snapshots captured that caller. The native31 compiler was never reached in that path. Do not repeat the old conclusion.
- Read-only inspection of installed xlive.dll confirmed its d3dx9_43.dll!D3DXCompileShader import (guest IAT 0x1322a5b8 in this fixture). Added installed 32-bit d3dx9_43.dll and d3dcompiler_43.dll to a private fixture with exact native preferences. Their actual guest code executes locally.
- Loading native d3dcompiler_43 initially failed on missing msvcrt:_mbstrlen ABI. Implemented real locale-aware character counting, invalid-sequence EILSEQ handling, null-input EINVAL/invalid-parameter callback and cdecl signature. Targeted tests cover C locale, UTF-8, Shift-JIS, invalid input and ABI. Johab validation is explicitly unsupported; broader existing CRT locale behavior is unchanged.
- Chrome now loads native d3dcompiler_43.dll and completes its native DllMain. Non-pausing fast breakpoints hit the real d3dx9_43 compiler entry and subsequent stages. Preprocessing returned S_OK (EAX=0); the return immediately after D3DCompile is E_OUTOFMEMORY (EAX=0x8007000e), preserved after the D3DX result wrapper. Halo logs failed rasterizer initialization and exits with code 0. Earliest-fault capture is empty on this run. This narrows the failure to the actual compiler stage; its internal cause remains unknown.
- Added h.debugState() to inspect live WASM debugger exports, JIT mode and breakpoints; added CPU registers to API call snapshots and exposed existing fast breakpoint option in DSL types.

## Next investigation

Trace native d3dcompiler_43 allocation/parser initialization without pausing the CPU. OOM is the compiler's returned error, not proof that host RAM is exhausted. Heap/VirtualAlloc requests in the retained trace succeeded. GetFullPathNameA('memory',0), then buffer size 10 produces C:\memory; source review confirms its successful return excludes NUL, so the suspected off-by-one is not present.

Use continuous:true, pause:false, fast:true. A pause:true native breakpoint experiment perturbed execution and produced EIP 0x555 followed by recursive crash reporting; this does not reproduce on the unpaused run and must not be reported as the native compiler's root fault. clearBreaks removes breakpoints, but reload restores JIT after non-fast tracing disables it.

Native43 observed base 0x13a10000; compiler entry RVA 0xe5fdb, after preprocessing 0xe6105, after D3DCompile 0xe6186, after result wrapping 0xe6198. D3DCompiler43 dynamically loaded at 0x14400000, D3DCompile RVA 0x66c20. Resolve live bases before reusing addresses.

## Private fixture and resume

Newest: work/halo2-browser/bundles/halo2-native-d3dx43.wgb, 671387462 bytes. Extends native31 fixture with C:/Windows/SysWOW64/d3dx9_43.dll (1998168 bytes) and d3dcompiler_43.dll (2106216 bytes). Manifest nativeDlls: d3dx9_31.dll, d3dx9_43.dll, d3dcompiler_43.dll. Prior native31 fixture remains intact. Never commit these DLLs or bundles.

Vite 5174 and log server 3001 remain running. Chrome browser 3, user tab 1897424839; verify identity before reuse. Reload then h.logBufferSize(20000), h.streamLogs(), fire-and-forget h.openWgb('/__wgb/?path='+encodeURIComponent('<workspace>/work/halo2-browser/bundles/halo2-native-d3dx43.wgb')). Forward-slash absolute paths. Wait for PCC, screenshot before Run. Current tab shows graceful Game exited after the trace. No security changes or native-install modifications.

Private evidence logs: bottleship-2026-10-01-05-1809-* contains native compiler load and OOM; final non-pausing trace confirms stage returns (recorded in this checkpoint). Logs stay outside Git. raw stream can drop batches; use bounded h.events(12,'breakHit') and h.faults(3,{first:true}), not large h.report()/logs dumps.

Validation this session: 10 focused tests / 74 assertions across five files pass; TypeScript clean; production Vite build passes (existing vendor externalization/chunk warnings). Previous checkpoint's 53-test run remains historical, not a new full-suite run. Keep unrelated bun.lock and generated/index line-ending edits unstaged.

## Research leads

See repository docs/halo2-research-leads.md for verified primary sources: Cartographer is closest to our current hook/graphics investigation; OpenH2 has a real Armory map/script/audio demo and is a useful format/engine reference, not a drop-in original engine port. Mutation and H2Codez concern map/editor tooling; Halo-2-HD targets original Xbox. Halo CE build2342 decomp is a separate engine/version reference. A universal claim that no matching Halo 2 PDB exists has not been established.

## GitHub checkpoint

Private branch codex/halo2-browser-checkpoint; existing draft PR #7 and main-menu issue #1. Keep issue #1 open until real responsive menu and fresh boot are verified. Issues #2-#6 remain unaccepted later milestones. Always use gh --repo sstewart207/halo2-browser. Credits and original upstream licenses remain preserved.

---

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
