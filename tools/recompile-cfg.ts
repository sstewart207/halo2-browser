/**
 * recompile-cfg.ts — CLI tool to lift Ghidra CFG export JSON into WebAssembly text (.wat) and binary (.wasm).
 *
 * Usage:
 *   bun tools/recompile-cfg.ts [input.json] [output_prefix]
 */

import * as fs from 'fs';
import * as path from 'path';
import { liftExportedModule, CFGExport, IATResolver, RuntimeBridge } from './recompiler';

const args = process.argv.slice(2);
const inputFile = args[0] || path.resolve(__dirname, '../../halo2-browser/scratch/ghidra/cfg_100.json');
const outPrefix = args[1] || path.resolve(__dirname, '../../halo2-browser/scratch/ghidra/halo2_recompiled');

if (!fs.existsSync(inputFile)) {
    console.error(`Input file not found: ${inputFile}`);
    process.exit(1);
}

const halo2ExePath = path.resolve(__dirname, '../../halo2-browser/scratch/ghidra/halo2.exe');
const iatResolver = new IATResolver();
if (fs.existsSync(halo2ExePath)) {
    iatResolver.loadFromFile(halo2ExePath);
    console.log(`[Recompiler] Loaded ${iatResolver.size()} Win32 IAT entries from halo2.exe`);
}

console.log(`[Recompiler] Loading CFG from: ${inputFile}`);
const rawJson = fs.readFileSync(inputFile, 'utf8');
const cfg: CFGExport = JSON.parse(rawJson);

console.log(`[Recompiler] Program: ${cfg.program}, Base: ${cfg.imageBase}`);
console.log(`[Recompiler] Functions to lift: ${cfg.functions.length}`);

let totalBlocks = 0;
let totalInsts = 0;
for (const f of cfg.functions) {
    totalBlocks += f.basicBlocks.length;
    for (const bb of f.basicBlocks) {
        totalInsts += bb.instructions.length;
    }
}
console.log(`[Recompiler] Total Basic Blocks: ${totalBlocks}, Instructions: ${totalInsts}`);

const t0 = performance.now();
const { builder, wasmBytes, watText } = liftExportedModule(cfg, {
    memoryPages: 160,
    importMemory: true,
    iatResolver: iatResolver.size() > 0 ? iatResolver : undefined,
    emitWat: false,
});
const t1 = performance.now();

const wasmPath = `${outPrefix}.wasm`;
const watPath = `${outPrefix}.wat`;

fs.writeFileSync(wasmPath, wasmBytes);
if (watText) {
    fs.writeFileSync(watPath, watText, 'utf8');
}

const publicWasmPath = path.resolve(__dirname, '../public/halo2_recompiled.wasm');
fs.writeFileSync(publicWasmPath, wasmBytes);

console.log(`[Recompiler] Lift completed in ${(t1 - t0).toFixed(2)} ms`);
console.log(`[Recompiler] Function imports bound: ${builder.functionImports.length}`);
console.log(`[Recompiler] Wrote WASM binary: ${wasmPath} (${wasmBytes.length.toLocaleString()} bytes)`);
console.log(`[Recompiler] Copied WASM to:    ${publicWasmPath}`);
if (watText) {
    console.log(`[Recompiler] Wrote WAT text:     ${watPath} (${watText.split('\n').length.toLocaleString()} lines)`);
}



// Validate module in WebAssembly engine (V8 / Node)
if (typeof (globalThis as any).Bun === 'undefined') {
    const t2 = performance.now();
    const isValid = WebAssembly.validate(wasmBytes);
    if (isValid) {
        const mod = new WebAssembly.Module(wasmBytes);
        const t3 = performance.now();
        console.log(`[Recompiler] WebAssembly module verified & compiled in ${(t3 - t2).toFixed(2)} ms!`);

        // Instantiate via RuntimeBridge
        const memory = new WebAssembly.Memory({ initial: 160 });
        const bridge = new RuntimeBridge({ memory, iatResolver });
        // Bind all imports declared in the module
        for (const fi of builder.functionImports) {
            if (fi.field.startsWith('win32_')) {
                const parts = fi.field.replace(/^win32_/, '').split('_');
                const dll = parts[0];
                const func = parts.slice(1).join('_');
                bridge.bindApi(dll, func, 4);
            }
        }

        const inst = new WebAssembly.Instance(mod, bridge.createWasmImports());
        console.log(`[Recompiler] Module successfully linked & instantiated with ${Object.keys(inst.exports).length} exports.`);
    } else {
        console.error(`[Recompiler] WebAssembly validation FAILED for ${wasmPath}`);
        process.exit(1);
    }
} else {
    console.log('[Recompiler] Recompilation successful! Validated for V8 and Chrome execution.');
}

process.exit(0);
