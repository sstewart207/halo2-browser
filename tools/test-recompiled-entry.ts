/**
 * test-recompiled-entry.ts — Verifies running the recompiled Halo 2 entry point
 * directly in native WebAssembly with zero CPU emulation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { IATResolver } from './recompiler/iat-resolver';
import { RuntimeBridge } from './recompiler/runtime-bridge';

import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exePath = path.resolve(__dirname, '../../halo2-browser/scratch/ghidra/halo2.exe');
const wasmPath = path.resolve(__dirname, '../../halo2-browser/scratch/ghidra/halo2_recompiled.wasm');

if (!fs.existsSync(exePath) || !fs.existsSync(wasmPath)) {
    console.error('Missing halo2.exe or halo2_recompiled.wasm');
    process.exit(1);
}

console.log('[TestEntry] Loading halo2.exe PE sections into linear memory...');
const peBytes = fs.readFileSync(exePath);

// Create linear memory (initial 128MB = 2048 pages)
const memory = new WebAssembly.Memory({ initial: 2048 });
const memBytes = new Uint8Array(memory.buffer);

// Map PE sections
const e_lfanew = peBytes.readUInt32LE(0x3c);
const numSections = peBytes.readUInt16LE(e_lfanew + 6);
const optHeaderSize = peBytes.readUInt16LE(e_lfanew + 20);
const imageBase = peBytes.readUInt32LE(e_lfanew + 24 + 28);
const secTableStart = e_lfanew + 24 + optHeaderSize;

for (let i = 0; i < numSections; i++) {
    const off = secTableStart + i * 40;
    const name = peBytes.toString('ascii', off, off + 8).replace(/\0+$/, '');
    const vAddr = peBytes.readUInt32LE(off + 12);
    const rSize = peBytes.readUInt32LE(off + 16);
    const rOffset = peBytes.readUInt32LE(off + 20);
    const dest = imageBase + vAddr;

    if (rSize > 0 && rOffset + rSize <= peBytes.length) {
        memBytes.set(peBytes.subarray(rOffset, rOffset + rSize), dest);
        console.log(`  Loaded ${name.padEnd(8)} to 0x${dest.toString(16)} (${(rSize / 1024).toFixed(1)} KB)`);
    }
}
// Initialize TEB at 0x00030000 and PEB at 0x00031000
const tebBase = 0x00030000;
const pebBase = 0x00031000;
const initView = new DataView(memory.buffer);
initView.setUint32(tebBase + 0x00, 0xffffffff, true); // ExceptionList
initView.setUint32(tebBase + 0x04, 0x001a0000, true); // StackBase
initView.setUint32(tebBase + 0x08, 0x00180000, true); // StackLimit
initView.setUint32(tebBase + 0x18, tebBase, true);    // Self
initView.setUint32(tebBase + 0x20, 1337, true);       // ProcessId
initView.setUint32(tebBase + 0x24, 42, true);         // ThreadId
initView.setUint32(tebBase + 0x30, pebBase, true);    // PEB

initView.setUint8(pebBase + 0x02, 0);                 // BeingDebugged = 0
initView.setUint32(pebBase + 0x08, imageBase, true);  // ImageBaseAddress
console.log(`[TestEntry] Initialized TEB at 0x${tebBase.toString(16)} and PEB at 0x${pebBase.toString(16)}`);

// Set up IAT resolver & RuntimeBridge
const iatResolver = new IATResolver();
iatResolver.loadFromFile(exePath);
console.log(`[TestEntry] Loaded ${iatResolver.size()} IAT entries.`);

// Populate IAT slots in linear memory so indirect calls through pointers (MOV EBX, [0x79b348]; CALL EBX)
// pass the IAT address directly to RuntimeBridge
const memView = new DataView(memory.buffer);
for (const entry of iatResolver.getAllEntries()) {
    memView.setUint32(entry.iatAddress, entry.iatAddress, true);
}

const bridge = new RuntimeBridge({
    memory,
    iatResolver,
    logCalls: true,
});

let nextHeapAddr = 0x00200000;

    let nextTlsIndex = 1;
    const tlsSlots = new Map<number, number>();

    // Provide standard basic implementations for initial startup APIs
    bridge.registerModule('kernel32', {
        LoadLibraryA: (_ctx, mem, args) => {
            const pName = args[0];
            let name = '';
            for (let i = pName; i < mem.length && mem[i] !== 0; i++) {
                name += String.fromCharCode(mem[i]);
            }
            return 0x50000000;
        },
        InterlockedExchange: (_ctx, _mem, args) => {
            const pTarget = args[0];
            const val = args[1];
            const old = memView.getUint32(pTarget, true);
            memView.setUint32(pTarget, val, true);
            return old;
        },
        DeleteCriticalSection: () => 1,
        GetSystemTimeAsFileTime: (_ctx, _mem, args) => {
            const pFileTime = args[0];
            const view = new DataView(memory.buffer);
            const nowMs = Date.now();
            const fileTime = BigInt(nowMs) * 10000n + 116444736000000000n;
            view.setUint32(pFileTime, Number(fileTime & 0xffffffffn), true);
            view.setUint32(pFileTime + 4, Number(fileTime >> 32n), true);
            return 0;
        },
        GetCurrentProcessId: () => 1337,
        GetCurrentThreadId: () => 42,
        GetTickCount: () => Math.floor(performance.now()),
        QueryPerformanceCounter: (_ctx, _mem, args) => {
            const pCounter = args[0];
            const view = new DataView(memory.buffer);
            const count = BigInt(Math.floor(performance.now() * 1000));
            view.setUint32(pCounter, Number(count & 0xffffffffn), true);
            view.setUint32(pCounter + 4, Number(count >> 32n), true);
            return 1;
        },
        QueryPerformanceFrequency: (_ctx, _mem, args) => {
            const pFreq = args[0];
            const view = new DataView(memory.buffer);
            view.setUint32(pFreq, 1000000, true);
            view.setUint32(pFreq + 4, 0, true);
            return 1;
        },
        GetStartupInfoA: (_ctx, _mem, args) => {
            const pStartupInfo = args[0];
            const view = new DataView(memory.buffer);
            view.setUint32(pStartupInfo, 68, true); // cb = 68
            return 0;
        },
        GetVersion: () => 0x01060000, // Windows Vista 6.0
        GetVersionExA: (_ctx, _mem, args) => {
            const pVer = args[0];
            const view = new DataView(memory.buffer);
            view.setUint32(pVer + 4, 6, true);       // dwMajorVersion = 6 (Vista)
            view.setUint32(pVer + 8, 0, true);       // dwMinorVersion = 0
            view.setUint32(pVer + 12, 6000, true);   // dwBuildNumber = 6000
            view.setUint32(pVer + 16, 2, true);      // dwPlatformId = VER_PLATFORM_WIN32_NT
            return 1;
        },
        InitializeCriticalSectionAndSpinCount: () => 1,
        GetProcessHeap: () => 0x00150000,
        HeapCreate: () => 0x00210000,
        HeapAlloc: (_ctx, _mem, args) => {
            const size = args[2] || 64;
            const addr = nextHeapAddr;
            nextHeapAddr = (nextHeapAddr + size + 15) & ~15;
            return addr;
        },
        HeapFree: () => 1,
        TlsAlloc: () => nextTlsIndex++,
        TlsSetValue: (_ctx, _mem, args) => {
            tlsSlots.set(args[0], args[1]);
            return 1;
        },
        TlsGetValue: (_ctx, _mem, args) => {
            return tlsSlots.get(args[0]) || 0;
        },
        TlsFree: (_ctx, _mem, args) => {
            tlsSlots.delete(args[0]);
            return 1;
        },
        DecodePointer: (_ctx, _mem, args) => args[0],
        EncodePointer: (_ctx, _mem, args) => args[0],
        SetLastError: () => 0,
        GetProcAddress: (_ctx, mem, args) => {
            const pName = args[1];
            if (pName <= 0xffff) {
                console.log(`[TestEntry] GetProcAddress called for ordinal #${pName}`);
                return 0;
            }
            let name = '';
            for (let i = pName; i < mem.length && mem[i] !== 0; i++) {
                name += String.fromCharCode(mem[i]);
            }
            console.log(`[TestEntry] GetProcAddress called for '${name}'`);
            if (name === 'DecodePointer' || name === 'EncodePointer') {
                return bridge.registerDynamicApi('kernel32', name);
            }
            if (name === 'FlsAlloc' || name === 'FlsFree' || name === 'FlsSetValue' || name === 'FlsGetValue') {
                return 0; // Trigger TLS fallback in CRT
            }
            return bridge.registerDynamicApi('kernel32', name);
        },
        ExitProcess: (_ctx, _mem, args) => {
            console.log(`[TestEntry] ExitProcess called with code: 0x${args[0].toString(16)}`);
            process.exit(0);
        },
        GetLastError: () => 0,
        GetModuleHandleA: (_ctx, _mem, _args) => imageBase,
        GetCommandLineA: () => {
            // Write command line to a fixed scratch area
            const cmdAddr = 0x180000;
            const cmdStr = 'halo2.exe -windowed\0';
            for (let i = 0; i < cmdStr.length; i++) {
                memBytes[cmdAddr + i] = cmdStr.charCodeAt(i);
            }
            return cmdAddr;
        },
    });

    // Pre-bind CRT delay-load GetProcAddress slot at 0x86d7b4
    const getProcAddrSlot = 0x0086d7b4;
    const dynamicGpa = bridge.registerDynamicApi('kernel32', 'GetProcAddress');
    memView.setUint32(getProcAddrSlot, dynamicGpa, true);
    console.log(`[TestEntry] Bound delay-load slot 0x${getProcAddrSlot.toString(16)} -> 0x${dynamicGpa.toString(16)} (kernel32!GetProcAddress)`);


    console.log('[TestEntry] Compiling and instantiating halo2_recompiled.wasm...');
    const wasmBytes = fs.readFileSync(wasmPath);
    const mod = new WebAssembly.Module(wasmBytes);

    // Auto-bind all imported functions declared in the WASM module
    for (const imp of WebAssembly.Module.imports(mod)) {
        if (imp.kind === 'function' && imp.name.startsWith('win32_')) {
            const parts = imp.name.replace(/^win32_/, '').split('_');
            const dll = parts[0];
            const func = parts.slice(1).join('_');
            bridge.bindApi(dll, func, 4);
        }
    }

    const instance = new WebAssembly.Instance(mod, bridge.createWasmImports());
    bridge.registerExports(instance.exports);
    console.log(`[TestEntry] WASM Instance created with ${Object.keys(instance.exports).length} exports.`);

const exports = instance.exports as any;
if (typeof exports.entry !== 'function') {
    console.error('[TestEntry] Missing "entry" export!');
    process.exit(1);
}

// Stack top at 0x19ff00
const stackTop = 0x19ff00;
console.log(`[TestEntry] Invoking native entry point entry(esp=0x${stackTop.toString(16)})...`);

try {
    const t0 = performance.now();
    const result = exports.entry(stackTop, 0, 0);
    const t1 = performance.now();
    console.log(`[TestEntry] entry() returned: 0x${(result >>> 0).toString(16)} in ${(t1 - t0).toFixed(2)} ms!`);
} catch (e: any) {
    console.log(`[TestEntry] Execution paused/trapped in entry(): ${e.message}`);
}

console.log(`[TestEntry] Invoking native ___tmainCRTStartup(esp=0x${stackTop.toString(16)})...`);
try {
    const t0 = performance.now();
    const result = exports.___tmainCRTStartup(stackTop, 0, 0);
    const t1 = performance.now();
    console.log(`[TestEntry] ___tmainCRTStartup() returned: 0x${(result >>> 0).toString(16)} in ${(t1 - t0).toFixed(2)} ms!`);
} catch (e: any) {
    console.log(`[TestEntry] Execution paused/trapped in ___tmainCRTStartup(): ${e.message}`);
}

