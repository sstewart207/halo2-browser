import {test,expect} from 'bun:test';
import {Lifter} from '../recompiler/lifter';
import {RuntimeBridge} from '../recompiler/runtime-bridge';
import {loadExtended80} from '../../src/worker/core/recompiler/x87-math';
import type {CFGFunction} from '../recompiler/types';
function fn(name:string,entry:number,instructions:[string,string][]):CFGFunction {
 return {name,entry:'0x'+entry.toString(16),rva:'0x'+entry.toString(16),size:instructions.length,basicBlocks:[{start:'0x'+entry.toString(16),end:'0x'+(entry+instructions.length-1).toString(16),instructions:instructions.map(([mnemonic,ops],n)=>({addr:'0x'+(entry+n).toString(16),len:1,mnemonic,ops})),destinations:[]}]};
}
function build(functions:CFGFunction[],offset=0){
 const memory=new WebAssembly.Memory({initial:2});const bridge=new RuntimeBridge({memory,memoryOffset:offset,memoryLength:65536});
 const l=new Lifter({importMemory:true,memoryPages:2});l.prepareModule(functions);functions.forEach((f,n)=>{l.liftFunction(f);l.moduleBuilder.addExport(f.name,0,n);});
 const i=new WebAssembly.Instance(new WebAssembly.Module(l.moduleBuilder.toBinary()),bridge.createWasmImports());(i.exports.guest_memory_base as WebAssembly.Global).value=offset;bridge.registerExports(i.exports);
 return {i,v:new DataView(memory.buffer,offset,65536),memory};
}
test('x87 doubles, stack pushes/pops and cosine survive an internal call at an offset',()=>{
 const caller=fn('caller',0x1000,[['FLD','double ptr [0x2000]'],['FLD','double ptr [0x2008]'],['CALL','0x1100'],['FSTP','double ptr [0x2010]'],['FSTP','double ptr [0x2018]'],['RET','']]);
 const callee=fn('callee',0x1100,[['FCOS',''],['RET','']]);
 const {i,v,memory}=build([caller,callee],0x1000);v.setFloat64(0x2000,12.125,true);v.setFloat64(0x2008,Math.PI,true);
 (i.exports.caller as Function)(0x8000,0,0);
 expect(v.getFloat64(0x2010,true)).toBeCloseTo(-1,14);expect(v.getFloat64(0x2018,true)).toBe(12.125);
 expect(new DataView(memory.buffer).getFloat64(0x2010,true)).toBe(0);
});
test('FSTSW and SAHF publish C2 as parity without overwriting upper EAX',()=>{
 const f=fn('range',0x1000,[['FLD','double ptr [0x2000]'],['FCOS',''],['MOV','EAX, 0x12340000'],['FSTSW','AX'],['SAHF',''],['RET','']]);
 const {i,v}=build([f]);v.setFloat64(0x2000,2**63,true);const result=(i.exports.range as Function)(0x8000,0,0);
 expect(result & 0xffff0000).toBe(0x12340000);expect(result & 0x400).toBe(0x400);expect((i.exports.x87_st0 as WebAssembly.Global).value).toBe(2**63);
});
test('FISTP obeys nearest-even, floor, ceil and truncation control modes',()=>{
 const f=fn('convert',0x1000,[['FLDCW','word ptr [0x2010]'],['FLD','double ptr [0x2000]'],['FISTP','dword ptr [0x2008]'],['MOV','EAX, dword ptr [0x2008]'],['RET','']]);
 const {i,v}=build([f]);v.setFloat64(0x2000,2.5,true);
 for(const [mode,result] of [[0,2],[1,2],[2,3],[3,2]]){v.setUint16(0x2010,0x37f|(mode<<10),true);expect((i.exports.convert as Function)(0x8000,0,0)).toBe(result);}
});
test('80-bit memory decoder respects guest offset, sign and explicit significand',()=>{
 const memory=new WebAssembly.Memory({initial:1});const v=new DataView(memory.buffer,0x1000,0x2000);v.setBigUint64(0x100,0xc000000000000000n,true);v.setUint16(0x108,0x3fff,true);
 expect(loadExtended80(memory,0x1000,0x2000,0x100)).toBe(1.5);v.setUint16(0x108,0xbfff,true);expect(loadExtended80(memory,0x1000,0x2000,0x100)).toBe(-1.5);
 expect(()=>loadExtended80(memory,0x1000,0x2000,0x1fff)).toThrow();
});

test('real parity branch follows FCOS status through FSTSW and SAHF',()=>{
 const f=fn('branch',0x1000,[['FLD','double ptr [0x2000]'],['FCOS',''],['FSTSW','AX'],['SAHF',''],['JP','0x1100']]);
 f.basicBlocks[0].destinations=[{addr:'0x1100',type:'CONDITIONAL_JUMP'},{addr:'0x1200',type:'FALL_THROUGH'}];
 f.basicBlocks.push(fn('yes',0x1100,[['MOV','EAX, 0x9'],['RET','']]).basicBlocks[0],fn('no',0x1200,[['MOV','EAX, 0x7'],['RET','']]).basicBlocks[0]);
 const {i,v}=build([f]);v.setFloat64(0x2000,Math.PI,true);expect((i.exports.branch as Function)(0x8000,0,0)).toBe(7);
 v.setFloat64(0x2000,2**63,true);expect((i.exports.branch as Function)(0x8000,0,0)).toBe(9);
});
