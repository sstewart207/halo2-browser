import fs from 'node:fs';
import {liftExportedModule, IATResolver, type CFGExport} from './recompiler';
import {rebaseCfg} from './recompiler/rebase-cfg';

// Private manifest: {mainCfg, mainPe, output, dlls:[{cfg,pe,base}]}.
// DLL bases must match the loader; never place this manifest or generated assets in Git.
const manifest=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const cfg:CFGExport=JSON.parse(fs.readFileSync(manifest.mainCfg,'utf8'));
const resolver=new IATResolver();resolver.loadFromFile(manifest.mainPe);
const dllNames:string[]=[];
for(const dll of manifest.dlls){
 const pe=fs.readFileSync(dll.pe), base=Number(dll.base);
 const native:CFGExport=JSON.parse(fs.readFileSync(dll.cfg,'utf8'));
 dllNames.push(native.program.replace(/\.dll$/i,'').toLowerCase());
 const rebased=rebaseCfg(native,pe,base);cfg.functions.push(...rebased.functions);
 resolver.loadFromBuffer(pe,base);
 console.log(`${native.program}: ${native.functions.length} functions, loaded base 0x${base.toString(16)}`);
}
const {builder}=liftExportedModule(cfg,{importMemory:true,memoryPages:160,iatResolver:resolver,emitWat:false,emitBinary:false,debugBlockLimit:1000000});
for(let i=0;i<manifest.dlls.length;i++){
 const dll=manifest.dlls[i],name=dllNames[i];
 const index=builder.addGlobal(0x7f,0,Number(dll.base));builder.addExport(`aot_native_base_${name}`,3,index);
}
const wasmBytes=builder.toBinary();
if(!WebAssembly.validate(wasmBytes as any))throw new Error('Combined native module failed WASM validation');
fs.writeFileSync(manifest.output,wasmBytes);
console.log(`Validated ${cfg.functions.length} functions, ${wasmBytes.length} bytes; wrote ${manifest.output}`);
