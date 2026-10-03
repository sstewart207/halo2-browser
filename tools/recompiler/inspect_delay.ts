import * as fs from 'fs';
import * as path from 'path';

const cfgPath = path.resolve(__dirname, '../../../halo2-browser/scratch/ghidra/cfg_full.json');
const text = fs.readFileSync(cfgPath, 'utf8');
const cfg = JSON.parse(text);

const fns = cfg.functions.filter((f: any) => {
    const entry = parseInt(f.entry, 16);
    return (entry >= 0x690700 && entry <= 0x690900) || f.name.includes('delay') || f.name.includes('Delay') || f.name.includes('ResolveThunk');
});

for (const fn of fns) {
    console.log(`Function: ${fn.name} at ${fn.entry} (blocks: ${fn.basicBlocks.length})`);
    for (const b of fn.basicBlocks) {
        for (const ins of b.instructions) {
            console.log(`  ${ins.addr}: ${ins.mnemonic} ${ins.ops}`);
        }
    }
}

