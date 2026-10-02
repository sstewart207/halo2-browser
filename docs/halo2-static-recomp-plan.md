# Halo 2 Static Recompilation Architecture Plan (60 FPS & iOS Browser Port)

Date: October 2, 2026  
Status: Approved Roadmap

---

## 1. Executive Summary & Problem Statement

Halo 2 Project Cartographer runs in desktop Chrome via BottleShip (a Win32 HLE runtime on top of the `v86` x86 PC emulator). While title screens, menus, and campaign levels boot, CPU performance is fundamentally constrained by emulation:
- **Desktop Chrome JIT:** Runs at ~14–19 FPS in-level (~38 ms/frame in `v86` CPU execution, ~14 ms/frame in thunk overhead).
- **iOS / Safari:** Apple's WebKit strictly forbids JIT compilation in third-party browser apps. The `v86` fallback interpreter crawls at **2–4 FPS**, making mobile browser play completely unviable under emulation.
- **Thunk Trapping Overhead:** Every Win32 / Direct3D / DirectSound call exits `v86` via an x86 `OUT` port instruction trap into JavaScript, burning ~14–22 ms per frame solely on emulator state transitions.

**Solution:** **Static Recompilation (AOT x86 $\to$ WebAssembly)**.  
Following the proven architectures of N64Recomp (Zelda Majora's Mask PC) and PSXRecomp (Pepsiman browser 60 FPS port), `halo2.exe`'s machine instructions are mechanically lifted ahead of time into WebAssembly.

---

## 2. Preservation of Existing BottleShip Assets

We do **not** throw away BottleShip:
1. **Direct3D 9 $\to$ WebGPU:** The shader recompiler (SM1/SM2/SM3 $\to$ WGSL), vertex attribute packer (`DEC3N`, `UDEC3`), render pass manager, and texture binding system remain 100% intact.
2. **Win32 HLE Runtime:** File I/O (`kernel32`), memory management (`VirtualAlloc`, `HeapAlloc`), window messaging (`user32`), and DirectInput/XInput/DirectSound remain intact.
3. **Difference:** Instead of `v86` executing machine code and trapping via `handlePortWrite` to invoke Win32 APIs, the recompiled WebAssembly binary calls BottleShip's HLE functions **directly as imported WASM functions**, with zero context-switch latency.

---

## 3. Workstation Tooling Verified

The workstation has all necessary tools pre-installed:
- **Ghidra 12.1.4 + Eclipse Adoptium JDK 25:**
  - Path: `C:\Users\sstew\Downloads\ghidra_12.1.4_PUBLIC_20260921\ghidra_12.1.4_PUBLIC`
  - Existing analyzed project: `work/halo2-browser/scratch/ghidra/proj`
  - Headless script runner: `analyzeHeadless.bat` for batch function and CFG extraction.
- **Visual Studio Build Tools 2026:**
  - `cmake.exe` & `ninja.exe` at `C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\...`
  - `cl.exe` (MSVC x64/x86).
- **Rust Toolchain:**
  - `rustc` and `cargo` installed at `C:\Users\sstew\.cargo\bin`
  - **`wasm32-unknown-unknown` target already installed**.
- **Cartographer Source:**
  - Complete symbols, structs, and hook signatures available in `work/cartographer-source`.

---

## 4. Recompilation Pipeline Architecture

```
+-----------------------------------------------------------+
|                    halo2.exe (14.7 MB)                    |
+-----------------------------------------------------------+
                             |
                             v
+-----------------------------------------------------------+
|       Stage 1: Headless Ghidra Analysis & Extraction      |
|  - Discover function entry points, boundaries & CFG       |
|  - Resolve jump tables (switch statements)                |
|  - Map Win32 IAT import calls to known API names          |
+-----------------------------------------------------------+
                             |
                             v (JSON / Intermediate IR)
+-----------------------------------------------------------+
|       Stage 2: AOT Lifter (x86 -> C / Rust / WASM)        |
|  - Map x86 registers (EAX..EDI, EFLAGS) to WASM locals    |
|  - Translate direct jumps to WASM structured control flow |
|  - Dispatch indirect calls via WASM call_indirect table   |
|  - Translate memory dereferences to WebAssembly.Memory    |
+-----------------------------------------------------------+
                             |
                             v
+-----------------------------------------------------------+
|            Stage 3: Linking with BottleShip               |
|  - Direct WASM imports for kernel32, d3d9, dinput, dsound |
|  - Eliminates v86 OUT port traps (<0.1 ms API overhead)   |
|  - WebGPU renders frame natively at 60 FPS                |
+-----------------------------------------------------------+
```

### Key Technical Considerations:
1. **Memory Addressing:**
   - Halo 2 addresses its 32-bit linear address space starting around `0x00400000` (PE base).
   - In WebAssembly, a 2 GB / 4 GB `WebAssembly.Memory` buffer mirrors guest physical memory directly (`i32.load` / `i32.store` with zero offset translation).
2. **Flags & Status Registers:**
   - Lazy flag evaluation (e.g., standard QEMU/v86 flag optimization): only compute `CF`, `ZF`, `SF`, `OF` when conditional jumps (`jz`, `jnz`, `jbe`, etc.) consume them.
3. **Indirect Calls / Jump Tables:**
   - Function pointers and vtables: A global function pointer table in WASM (`table (elem func ...)`) indexed by rebased function addresses.
   - Switch statements: Ghidra identifies jump table bounds; lifter emits `br_table` instructions.
4. **Win32 Thunks:**
   - Every import in the Import Address Table (IAT) is routed directly to an exported JavaScript/WASM function in BottleShip, completely bypassing the emulator.

---

## 5. Phased Implementation Roadmap

### Stage 1: Headless Ghidra Analysis & Extraction (COMPLETE - NEWEST-32)
- **Status:** Complete & verified.
- **Extractor:** [`tools/ExportFunctionCFG.java`](file:///c:/Users/sstew/Documents/Codex/2026-09-29/private-just-for-us-do-i/work/halo2-browser/scratch/ghidra/ExportFunctionCFG.java) run via [`tools/extract-ghidra-cfg.ps1`](file:///c:/Users/sstew/Documents/Codex/2026-09-29/private-just-for-us-do-i/work/bottleship-research/tools/extract-ghidra-cfg.ps1).
- **Output:** Disassembles basic blocks, boundaries, instructions, and CFG edges into structured JSON (e.g. `cfg_sample.json`, `cfg_100.json`).

### Stage 2: AOT x86 -> WebAssembly Lifter (COMPLETE - NEWEST-33)
- **Status:** Complete & verified (commit `81b28ae`).
- **Lifter Engine:** Located in [`tools/recompiler/`](file:///c:/Users/sstew/Documents/Codex/2026-09-29/private-just-for-us-do-i/work/bottleship-research/tools/recompiler):
  - `parser.ts`: Handles all 32-bit registers, sub-registers (`AL`/`AH` etc.), and effective addresses (`[base + index*scale + disp]`).
  - `wasm-builder.ts`: Direct zero-dependency binary WebAssembly (`Uint8Array`) and WAT text emitter with ULEB128/SLEB128 variable-length integer encoding.
  - `lifter.ts`: Maps registers to WASM locals, evaluates arithmetic/logic/memory/stack operations, tracks EFLAGS (`ZF`, `SF`, `CF`, `OF`), and structures arbitrary CFG branches and loops via `br_table` dispatch.
- **Verification:** [`tools/tests/recompiler-lifter.test.ts`](file:///c:/Users/sstew/Documents/Codex/2026-09-29/private-just-for-us-do-i/work/bottleship-research/tools/tests/recompiler-lifter.test.ts). 12/12 unit tests pass in 49ms.

### Stage 3: Runtime Linking & Win32 IAT Bridge (COMPLETE - NEWEST-34)
- **Status:** Complete & verified (commit `9d4a8d7`).
- **IAT Resolver:** [`tools/recompiler/iat-resolver.ts`](file:///c:/Users/sstew/Documents/Codex/2026-09-29/private-just-for-us-do-i/work/bottleship-research/tools/recompiler/iat-resolver.ts) parses PE headers from `halo2.exe` to map all 413 Win32 IAT slots to exact DLL/API names.
- **Runtime Bridge:** [`tools/recompiler/runtime-bridge.ts`](file:///c:/Users/sstew/Documents/Codex/2026-09-29/private-just-for-us-do-i/work/bottleship-research/tools/recompiler/runtime-bridge.ts) binds typed WASM function imports directly to BottleShip HLE modules (`Kernel32`, `User32`, `D3D9`, etc.) over shared linear `WebAssembly.Memory`.
- **Zero-Trap Calls:** `CALL [IAT_SLOT]` routes directly to imported WebAssembly functions, reading stdcall parameters from stack linear memory with zero v86 emulator OUT-port traps (<0.1 ms overhead).
- **Verification:** [`tools/tests/recompiler-runtime-bridge.test.ts`](file:///c:/Users/sstew/Documents/Codex/2026-09-29/private-just-for-us-do-i/work/bottleship-research/tools/tests/recompiler-runtime-bridge.test.ts). All 15 recompiler tests pass. All 954 project tests pass.

### Stage 4: Full Game Binary Recompilation & Game Loop Integration (NEXT)
- **Step 1:** Run full headless Ghidra extraction on `halo2.exe` (`MaxFunctions = 0`) to extract all 15,893 functions into `cfg_halo2_full.json`.
- **Step 2:** Recompile the full binary using `bun tools/recompile-cfg.ts cfg_halo2_full.json halo2_full`.
- **Step 3:** Hook entry point and core tick loop (`game_tick`, window pump, frame presentation) in BottleShip's worker bootloader.
- **Step 4:** Benchmark FPS in desktop Chrome and test WebGPU on iOS Safari to verify **steady 60 FPS**.
