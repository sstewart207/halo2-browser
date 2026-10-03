import fs from 'fs';
import { RuntimeBridge } from '../src/worker/core/recompiler/runtime-bridge';
import { IATResolver } from './recompiler/iat-resolver';

const wasmBytes = fs.readFileSync('../halo2-browser/scratch/ghidra/halo2-native62.wasm');
const peBytes = fs.readFileSync('../halo2-browser/scratch/ghidra/pccompat.dll');

// 512MB linear memory
const memory = new WebAssembly.Memory({ initial: 8192 });
const memBytes = new Uint8Array(memory.buffer);
const view = new DataView(memory.buffer);

// Load pccompat.dll PE sections at 0x13c10000
const e_lfanew = peBytes.readUInt32LE(0x3c);
const optSize = peBytes.readUInt16LE(e_lfanew + 20);
const numSecs = peBytes.readUInt16LE(e_lfanew + 6);
const secTable = e_lfanew + 24 + optSize;
const loadedBase = 0x13c10000;
const prefBase = peBytes.readUInt32LE(e_lfanew + 24 + 28);
const delta = loadedBase - prefBase;

for (let i = 0; i < numSecs; i++) {
    const vAddr = peBytes.readUInt32LE(secTable + i * 40 + 12);
    const rSize = peBytes.readUInt32LE(secTable + i * 40 + 16);
    const rOff = peBytes.readUInt32LE(secTable + i * 40 + 20);
    if (rSize > 0 && rOff + rSize <= peBytes.length) {
        memBytes.set(peBytes.subarray(rOff, rOff + rSize), loadedBase + vAddr);
    }
}

// Apply relocations
const relocRVA = peBytes.readUInt32LE(e_lfanew + 24 + 136);
const relocSize = peBytes.readUInt32LE(e_lfanew + 24 + 140);
if (relocRVA && relocSize) {
    function rvaToOffset(rva: number) {
        for (let i = 0; i < numSecs; i++) {
            const vAddr = peBytes.readUInt32LE(secTable + i * 40 + 12);
            const rSize = peBytes.readUInt32LE(secTable + i * 40 + 16);
            const rOff = peBytes.readUInt32LE(secTable + i * 40 + 20);
            if (rva >= vAddr && rva < vAddr + rSize) return rOff + (rva - vAddr);
        }
        return null;
    }
    let used = 0;
    while (used < relocSize) {
        const off = rvaToOffset(relocRVA + used)!;
        const page = peBytes.readUInt32LE(off);
        const len = peBytes.readUInt32LE(off + 4);
        for (let j = 8; j < len; j += 2) {
            const rec = peBytes.readUInt16LE(off + j);
            if ((rec >>> 12) === 3) {
                const patchAddr = loadedBase + page + (rec & 0xfff);
                const curVal = view.getUint32(patchAddr, true);
                view.setUint32(patchAddr, curVal + delta, true);
            }
        }
        used += len;
    }
}

// Setup TEB/PEB
const tebBase = 0x00030000;
view.setUint32(tebBase + 0x00, 0xffffffff, true); // ExceptionList
view.setUint32(tebBase + 0x04, 0x001a0000, true); // StackBase
view.setUint32(tebBase + 0x08, 0x00180000, true); // StackLimit
view.setUint32(tebBase + 0x18, tebBase, true);    // Self
view.setUint32(tebBase + 0x20, 1337, true);
view.setUint32(tebBase + 0x24, 42, true);
view.setUint32(tebBase + 0x30, 0x00031000, true); // PEB

// Simple heap
let nextHeap = 0x01500000;
const heapAlloc = (_ctx: any, _mem: any, args: number[]) => {
    const size = args[2] ?? 16;
    const ptr = nextHeap;
    nextHeap = (nextHeap + size + 15) & ~15;
    return ptr;
};

const bridge = new RuntimeBridge({
    memory,
    logCalls: false,
});

const k32 = {
    GetProcessHeap: () => 0x12345679,
    HeapAlloc: heapAlloc,
    HeapFree: () => 1,
    HeapSize: () => 64,
    GetVersionExA: (_ctx: any, _mem: any, args: number[]) => {
        const ptr = args[0];
        if (ptr) {
            view.setUint32(ptr + 4, 6, true); // MajorVersion = 6 (Vista)
            view.setUint32(ptr + 8, 0, true); // MinorVersion = 0
            view.setUint32(ptr + 12, 6000, true); // BuildNumber
            view.setUint32(ptr + 16, 2, true); // PlatformId = VER_PLATFORM_WIN32_NT
        }
        return 1;
    },
    GetSystemTimeAsFileTime: () => 0,
    GetCurrentProcessId: () => 1234,
    GetTickCount: () => 1000,
    QueryPerformanceCounter: () => 1,
    GetCurrentThreadId: () => 42,
    GetCommandLineA: () => {
        const cmdPtr = 0x00040000;
        memBytes.set(new TextEncoder().encode('halo2.exe\0'), cmdPtr);
        return cmdPtr;
    },
    GetEnvironmentStringsW: () => {
        const envPtr = 0x00041000;
        view.setUint16(envPtr, 0, true);
        view.setUint16(envPtr + 2, 0, true);
        return envPtr;
    },
    FreeEnvironmentStringsW: () => 1,
    InitializeCriticalSection: () => 0,
    EnterCriticalSection: () => 0,
    LeaveCriticalSection: () => 0,
    DeleteCriticalSection: () => 0,
    HeapCreate: () => 0x12345679,
    HeapDestroy: () => 1,
    VirtualAlloc: (_ctx: any, _mem: any, args: number[]) => heapAlloc(_ctx, _mem, [0, 0, args[1]]),
    TlsGetValue: () => 0,
    TlsSetValue: () => 1,
    TlsAlloc: () => 1,
    TlsFree: () => 1,
    InterlockedIncrement: (_ctx: any, _mem: any, args: number[]) => {
        const ptr = args[0];
        const val = (view.getInt32(ptr, true) + 1) | 0;
        view.setInt32(ptr, val, true);
        return val;
    },
    InterlockedDecrement: (_ctx: any, _mem: any, args: number[]) => {
        const ptr = args[0];
        const val = (view.getInt32(ptr, true) - 1) | 0;
        view.setInt32(ptr, val, true);
        return val;
    },
    InterlockedExchange: (_ctx: any, _mem: any, args: number[]) => {
        const ptr = args[0];
        const oldVal = view.getInt32(ptr, true);
        view.setInt32(ptr, args[1], true);
        return oldVal;
    },
    GetModuleHandleA: (_ctx: any, _mem: any, args: number[]) => {
        const namePtr = args[0];
        let name = '';
        if (namePtr) {
            let p = namePtr;
            while (memBytes[p]) name += String.fromCharCode(memBytes[p++]);
        }
        console.log(`[debug-pccompat] GetModuleHandleA("${name}")`);
        return 0x7c800000;
    },
    GetProcAddress: (_ctx: any, _mem: any, args: number[]) => {
        const procPtr = args[1];
        let proc = '';
        if (procPtr > 0xffff) {
            let p = procPtr;
            while (memBytes[p]) proc += String.fromCharCode(memBytes[p++]);
        } else {
            proc = `ordinal#${procPtr}`;
        }
        console.log(`[debug-pccompat] GetProcAddress(0x${args[0].toString(16)}, "${proc}")`);
        return 0; // Return 0 for Fls* and Encode/DecodePointer so fallback TLS is used
    },
};
bridge.registerModule('kernel32', k32);
bridge.registerModule('kernel32.dll', k32);
bridge.registerModule('KERNEL32.dll', k32);
bridge.registerModule('KERNEL32', k32);

// Bind IAT of pccompat.dll
const iatResolver = new IATResolver();
iatResolver.loadFromBuffer(peBytes, loadedBase);
bridge.iatResolver = iatResolver;

// Parse in-memory IAT to dynamic table
let descOff = 0;
const importDirRVA = peBytes.readUInt32LE(e_lfanew + 24 + 104);
const importDirSize = peBytes.readUInt32LE(e_lfanew + 24 + 108);
if (importDirRVA && importDirSize) {
    let d = loadedBase + importDirRVA;
    while (true) {
        const nameRVA = view.getUint32(d + 12, true);
        const iatRVA = view.getUint32(d + 16, true);
        const iltRVA = view.getUint32(d + 0, true);
        if (!nameRVA) break;
        let dllName = '';
        let np = loadedBase + nameRVA;
        while (memBytes[np]) dllName += String.fromCharCode(memBytes[np++]);
        let thunkRVA = iltRVA || iatRVA;
        let i = 0;
        while (true) {
            const thunkVal = view.getUint32(loadedBase + thunkRVA + i * 4, true);
            const slot = loadedBase + iatRVA + i * 4;
            if (!thunkVal) break;
            if (!(thunkVal & 0x80000000)) {
                let fnName = '';
                let fnp = loadedBase + thunkVal + 2;
                while (memBytes[fnp]) fnName += String.fromCharCode(memBytes[fnp++]);
                bridge.registerIatEntry(slot, dllName, fnName);
                const thunk = bridge.registerDynamicApi(dllName, fnName);
                view.setUint32(slot, thunk, true);
            }
            i++;
        }
        d += 20;
    }
}

console.log('Compiling WASM...');
const mod = await WebAssembly.compile(wasmBytes);

for (const imp of WebAssembly.Module.imports(mod)) {
    if (imp.kind === 'function' && imp.name.startsWith('win32_')) {
        const parts = imp.name.slice('win32_'.length).split('_');
        const dll = parts[0];
        const func = parts.slice(1).join('_');
        bridge.bindApi(dll, func, 4);
    }
}

console.log('Instantiating WASM...');
const instance = await WebAssembly.instantiate(mod, bridge.createWasmImports());
const exports = instance.exports as any;
bridge.registerExports(exports);

// Set stack top
const stackTop = 0x0019ff00;
const esp = stackTop - 16;
view.setUint32(esp, 0, true); // return address
view.setUint32(esp + 4, loadedBase, true); // hinstDLL
view.setUint32(esp + 8, 1, true); // DLL_PROCESS_ATTACH
view.setUint32(esp + 12, 1, true); // lpReserved

const dllMain = exports['addr_0x13c3a118'] || exports['pccompat_dll_entry'];
console.log('Invoking pccompat DllMain at 0x13c3a118 with esp=0x' + esp.toString(16) + '...');
try {
    const res = dllMain(esp, 0, 0);
    console.log('SUCCESS! DllMain returned:', res);
} catch (err: any) {
    console.error('FAILED with error:', err.message);
    console.error('aot_debug_pc: 0x' + (exports.aot_debug_pc?.value >>> 0).toString(16));
    console.error('esp global: 0x' + (exports.esp?.value >>> 0).toString(16));
    console.error('ebp global: 0x' + (exports.ebp?.value >>> 0).toString(16));
    console.error('ebx global: 0x' + (exports.ebx?.value >>> 0).toString(16));
    console.error('esi global: 0x' + (exports.esi?.value >>> 0).toString(16));
    console.error('edi global: 0x' + (exports.edi?.value >>> 0).toString(16));
}
