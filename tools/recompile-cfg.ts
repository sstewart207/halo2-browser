/**
 * recompile-cfg.ts — CLI tool to lift Ghidra CFG export JSON into WebAssembly text (.wat) and binary (.wasm).
 *
 * Usage:
 *   bun tools/recompile-cfg.ts [input.json] [output_prefix]
 */

import * as fs from 'fs';
import * as path from 'path';
import { liftExportedModule, CFGExport } from './recompiler';

const args = process.argv.slice(2);
const inputFile = args[0] || path.resolve(__dirname, '../../halo2-browser/scratch/ghidra/cfg_100.json');
const outPrefix = args[1] || path.resolve(__dirname, '../../halo2-browser/scratch/ghidra/halo2_recompiled');

if (!fs.existsSync(inputFile)) {
    console.error(`Input file not found: ${inputFile}`);
    process.exit(1);
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
const { wasmBytes, watText } = liftExportedModule(cfg, { memoryPages: 160 });
const t1 = performance.now();

const wasmPath = `${outPrefix}.wasm`;
const watPath = `${outPrefix}.wat`;

fs.writeFileSync(wasmPath, wasmBytes);
fs.writeFileSync(watPath, watText, 'utf8');

console.log(`[Recompiler] Lift completed in ${(t1 - t0).toFixed(2)} ms`);
console.log(`[Recompiler] Wrote WASM binary: ${wasmPath} (${wasmBytes.length.toLocaleString()} bytes)`);
console.log(`[Recompiler] Wrote WAT text:     ${watPath} (${watText.split('\n').length.toLocaleString()} lines)`);

// Validate module in WebAssembly engine
const t2 = performance.now();
const isValid = WebAssembly.validate(wasmBytes);
if (isValid) {
    const mod = new WebAssembly.Module(wasmBytes);
    const t3 = performance.now();
    console.log(`[Recompiler] WebAssembly module verified & compiled in ${(t3 - t2).toFixed(2)} ms!`);
    const inst = new WebAssembly.Instance(mod);
    console.log(`[Recompiler] Module successfully instantiated with ${Object.keys(inst.exports).length} exports.`);
} else {
    console.error(`[Recompiler] WebAssembly validation FAILED for ${wasmPath}`);
    process.exit(1);
}

process.exit(0);
