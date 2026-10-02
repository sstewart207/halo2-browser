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

### Phase 1: Prototype Extraction & Lifter (In Progress - Stage 1 Extractor Complete)
- **Status:** Headless Ghidra script [`ExportFunctionCFG.java`](file:///c:/Users/sstew/Documents/Codex/2026-09-29/private-just-for-us-do-i/work/halo2-browser/scratch/ghidra/ExportFunctionCFG.java) implemented and verified.
- **Runner:** Run [`tools/extract-ghidra-cfg.ps1`](file:///c:/Users/sstew/Documents/Codex/2026-09-29/private-just-for-us-do-i/work/bottleship-research/tools/extract-ghidra-cfg.ps1) to extract function boundaries, basic blocks, disassembled x86 instructions, and CFG destinations from `halo2.exe` into structured JSON (see [`cfg_sample.json`](file:///c:/Users/sstew/Documents/Codex/2026-09-29/private-just-for-us-do-i/work/halo2-browser/scratch/ghidra/cfg_sample.json)).
- **Next Task for Lifter:** Implement the x86 basic-block to WebAssembly lifter (TypeScript or Rust with `wasm32-unknown-unknown` target) translating the exported JSON blocks to `.wat` or WASM bytecode.

### Phase 2: Runtime Shim & Memory Bridge
- Allocate a shared `WebAssembly.Memory` buffer matching BottleShip's existing guest RAM layout.
- Connect recompiled WASM function calls to BottleShip's existing JS/WASM Win32 API table.
- Verify basic math, string, and utility functions run correctly outside `v86`.

### Phase 3: Graphics & Game Loop Integration
- Connect D3D9 device creation and frame presentation to BottleShip's WebGPU device.
- Recompile the game's core update loop (`game_tick`) and rasterizer setup.
- Benchmark FPS on desktop Chrome and iOS Safari. Goal: **Steady 60 FPS**.
