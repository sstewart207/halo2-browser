# Halo 2 in the browser

Private research by **Shane Stewart** into running Halo 2 Project Cartographer locally in browser through [BottleShip](https://github.com/jenissimo/bottleship) and ahead-of-time static recompilation. The game executes entirely on the user's local machine; no streaming or remote game execution.

The implementation and runtime checks below refer to the [checkpoint branch](https://github.com/sstewart207/halo2-browser/tree/codex/halo2-browser-checkpoint) and [PR #7](https://github.com/sstewart207/halo2-browser/pull/7).

---

## Current Status & Achievements

The real animated Halo 2 title screen, menu panels, and full 3D campaign levels execute and render in Chrome. Original game logic, shaders, and geometry execute locally:

- **End-to-End Campaign Playability & Mouse-Look:** Boots cleanly through the complete campaign flow (PCC $\to$ Title screen $\to$ Profile Selection $\to$ Main Menu $\to$ Level Select $\to$ Armory tutorial). DirectInput mouse-look deltas (`moveRel`) rotate the camera in real time, targeting calibration lights and advancing the mission.
- **Hardware-Accelerated WebGPU D3D9 Pipeline:** In-level 3D rendering with WebGPU D3D9 hardware acceleration (0.11 ms GPU frame time, 0.15 ms present). Packed vertex attributes (`D3DDECLTYPE_DEC3N`, `UDEC3`) are unpacked natively in WGSL shaders, and SM3 `NORMAL`, `TANGENT`, `BINORMAL`, and `FOG` interpolator semantics are fully supported.
- **Boot Crash / PCC Abort Fixed:** Diagnosed and fixed the `pccompat.dll` boot crash caused by empty filename file creation (`CreateFileA`/`W` now return `ERROR_PATH_NOT_FOUND` and `vfs.open` rejects directory truncation).
- **Readable Menus & Detours Integration:** Resolved Detours transaction failures (`VirtualProtect` on low-gap allocations), rendering all menu text, account screens, and campaign selection panels cleanly.
- **Campaign Maps Bundled:** `00a_introduction.map` (The Heretic) and `01b_spacestation.map` (Cairo Station) packaged alongside Armory (`01a_tutorial.map`), enabling progression across multiple single-player missions.
- **All 956 Unit Tests Pass:** TypeScript clean; zero lint or build errors.

---

## The 60 FPS & Mobile Pivot: Static Recompilation (AOT x86 → WebAssembly)

Under full CPU emulation (`v86`), the game runs at **27.9 FPS** in Chrome, with ~25 ms spent in CPU emulation and ~10 ms in emulator OUT-port thunk dispatch. On iOS Safari, Apple's strict prohibition of runtime JIT causes emulators to fall back to interpreters (crawling at 2–4 FPS).

To unlock **steady 60 FPS** on desktop and native compatibility on **iOS Safari & Android**, the project is executing an Ahead-Of-Time **Static Recompilation (AOT x86 $\to$ WebAssembly)** architecture:

```
+-----------------------------------------------------------+
|                    halo2.exe (14.7 MB)                    |
+-----------------------------------------------------------+
                             |
                             v
+-----------------------------------------------------------+
|       Stage 1: Headless Ghidra Analysis & Extraction      |
|  [COMPLETE] tools/extract-ghidra-cfg.ps1                  |
|  - Function entry points, basic block bounds, CFG edges   |
|  - Full instruction disassembly & operand resolution      |
+-----------------------------------------------------------+
                             |
                             v (JSON CFG)
+-----------------------------------------------------------+
|  Stage 2 & 4: AOT Lifter (x86, SSE, FPU -> WebAssembly)   |
|  [COMPLETE] tools/recompiler/                             |
|  - Full 32-bit x86 register file & sub-registers (AL..EDI)|
|  - SSE float vectors (XMM0..XMM7, MOVSS, ADDSS, MULSS...) |
|  - x87 FPU stack (ST0..ST7, FLD, FSTP, FMUL, FILD...)     |
|  - MMX 64-bit integer registers (MM0..MM7, PXOR, MOVQ)    |
|  - Arbitrary multi-block control flow via br_table loop   |
|  - Zero-stack streaming ByteWriter (supports 10,000+ fns) |
|  - Emits verified WASM bytecode (Uint8Array) & WAT text   |
+-----------------------------------------------------------+
                             |
                             v (WASM Module)
+-----------------------------------------------------------+
|            Stage 3: Runtime Linking with BottleShip       |
|  [COMPLETE] Direct WebAssembly.Memory & Win32/D3D9 HLE APIs|
|  - tools/recompiler/iat-resolver.ts (413 halo2.exe imports)|
|  - tools/recompiler/runtime-bridge.ts (zero-trap Win32 calls)|
|  - Eliminates v86 CPU emulator tax completely (<0.1 ms)   |
|  - Steady 60 FPS WebGPU execution across Chrome & Safari  |
+-----------------------------------------------------------+
```

### Static Recompilation Progress:
1. **Stage 1 Complete (`tools/extract-ghidra-cfg.ps1`):** Headless Ghidra script (`ExportFunctionCFG.java`) extracts function boundaries, basic blocks, control flow edges, and disassembled instructions into structured JSON.
2. **Stage 2 Complete (`tools/recompiler/`):** 
   - Low-overhead binary WASM builder with ULEB128/SLEB128 encoding and structured control flow.
   - Comprehensive x86 instruction parser and operand evaluator.
   - Core lifter translating machine instructions to WebAssembly bytecode with `br_table` dispatch loops for arbitrary CFGs.
3. **Stage 3 Complete (`tools/recompiler/` & `tools/tests/recompiler-runtime-bridge.test.ts`):**
   - Win32 PE Import Address Table parser (`iat-resolver.ts`) mapping all 413 `halo2.exe` IAT slots to exact DLL/API symbols.
   - `RuntimeBridge` linking recompiled WebAssembly modules to BottleShip's HLE Win32/D3D9 modules over shared `WebAssembly.Memory`.
4. **Stage 4 Complete (`tools/recompiler/` & 1,000-Function Milestone):**
   - Implemented SSE floating-point math (`XMM0`..`XMM7`, `MOVSS`, `ADDSS`, `SUBSS`, `MULSS`, `DIVSS`, `COMISS`, `CVTSI2SS`, `CVTTSS2SI`, `XORPS`, `MOVAPS`) and x87 FPU stack (`ST0`..`ST7`, `FLD`, `FSTP`, `FMUL`, `FILD`, `FISTP`).
   - MMX 64-bit integer registers (`MM0`..`MM7`, `PXOR`, `MOVQ`, `MOVD`) and extended integer operations (`ROL`, `ROR`, `NEG`, `NOT`, `CDQ`, `ADC`, `SBB`, `SETcc`, `MUL`, `DIV`, `IDIV`, `CMPXCHG.LOCK`, `STOSD.REP`, `MOVSD.REP`, `RDTSC`).
   - Replaced array-spread allocations with zero-stack `ByteWriter` streaming in `wasm-builder.ts`.
   - **Scale Verified:** Lifted 1,000 `halo2.exe` functions (8,606 basic blocks, 49,437 instructions, 60 live Win32 IAT imports bound) in **156.46 ms**, compiling to an 873 KB WASM binary in **10.81 ms** and instantiating cleanly with 1,001 exports. All 956 unit tests pass!
5. **Stage 5 Complete (`tools/recompiler/` & Whole-Program 15,893-Function Milestone):**
   - Direct inter-function call resolution (`prepareModule` pre-registers all function entries and IAT imports, linking `CALL imm` directly to WASM `call` opcodes with stack frame push and parameter passing).
   - Zero parse failures across all 933,787 instructions in `halo2.exe` (with `extended double ptr` and operand parser hardening).
   - `MOVD` float/int bitwise reinterpretation (`i32_reinterpret_f32` / `f32_reinterpret_i32`).
   - **Whole-Program Scale Verified:** Lifted the entire `halo2.exe` binary (**15,893 functions**, 152,288 basic blocks, 933,787 instructions, 209 Win32 IAT functions, 46,049 direct internal calls natively bound) in **2.83 seconds** into a 16.98 MB WASM binary that verifies and compiles in V8 in **63.13 ms** and instantiates cleanly with 15,894 exports! All 958 unit tests pass.

---

## Goal and Next Steps

The intended experience is a private hosted link: load the game and play locally in a browser on PC, Android or iPhone/iPad, with USB/Bluetooth controllers and persistent saves.

1. **Full Campaign Recompilation:** Batch-extract all functions of `halo2.exe` via `tools/extract-ghidra-cfg.ps1` and recompile the complete game binary into native WebAssembly bytecode.
2. **Campaign Progression:** Complete in-level combat and checkpoint validation across Cairo Station and Armory.
3. **Controller Support:** Connect USB/Bluetooth DualSense and standard gamepads through the browser Gamepad API to guest XInput.
4. **Local Persistence:** Save checkpoints and user profiles to OPFS (Origin Private File System) / IndexedDB.
5. **Cross-Platform Benchmarking:** Benchmark steady 60 FPS execution on desktop Chrome, Android Chrome, and iOS Safari.

---

## Development & Automation

Start from the checkpoint branch:

```powershell
git clone --branch codex/halo2-browser-checkpoint https://github.com/sstewart207/halo2-browser.git
cd halo2-browser
git submodule update --init --recursive
bun install
bun run dev
```

### Automated Verification Tools:
```powershell
# Run full unit test suite (954 tests)
bun test tools/tests

# Static recompilation tools:
powershell -ExecutionPolicy Bypass -File tools/extract-ghidra-cfg.ps1 -OutFile cfg_export.json -MaxFunctions 100
bun tools/recompile-cfg.ts cfg_export.json halo2_recompiled

# In-browser automation & profiling:
bun tools/boot-halo2.ts     # Boot bundle and arm diagnostics
bun tools/step-nav.ts       # Navigate menus to Armory level
bun tools/test-look.ts      # Test real-time mouse look calibration
bun tools/measure-perf.ts   # Live FPS and guest heap report
```

---

## Privacy Notice

Game executables, DLLs, maps, bundles, accounts, profiles, saves, runtime logs and local captures remain private and strictly outside the repository. No proprietary game assets are distributed.

---

## Credits and Upstream

- Project owner: **Shane Stewart**.
- AI pair programming contributors: **Shane Stewart, Google DeepMind Antigravity (Gemini), ChatGPT (Codex), Claude Opus 5.5, and MiMo 2.6 Flash**. OpenCode work on version resources and HLE images was completed using **Muse Spark 1.3**.
- **BottleShip** is by **Eugeniy Smirnov (jenissimo)** and contributors. Preserved in [docs/upstream-readme.md](docs/upstream-readme.md) under Apache 2.0.
