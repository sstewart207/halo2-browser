import {test,expect} from 'bun:test';
import {Lifter} from '../recompiler/lifter';
import {RuntimeBridge} from '../recompiler/runtime-bridge';
import type {CFGFunction} from '../recompiler/types';
function build(operand:string,index:string,setup:string[][]=[]){
 const ops=[...setup,['BT',`${operand}, ${index}`],['PUSHFD',''],['POP','EAX'],['RET','']];
 const f:CFGFunction={name:'run',entry:'0x1000',rva:'0',size:ops.length,basicBlocks:[{start:'0x1000',end:'0x1100',instructions:ops.map(([mnemonic,ops],n)=>({addr:`0x${(0x1000+n).toString(16)}`,len:1,mnemonic,ops})),destinations:[]}]};
 const l=new Lifter({importMemory:true,memoryPages:2});l.prepareModule([f]);l.liftFunction(f);l.moduleBuilder.addExport('run',0,0);
 const memory=new WebAssembly.Memory({initial:2});const bridge=new RuntimeBridge({memory,memoryOffset:0x1000,memoryLength:65536});const i=new WebAssembly.Instance(new WebAssembly.Module(l.moduleBuilder.toBinary()),bridge.createWasmImports());bridge.registerExports(i.exports);(i.exports.guest_memory_base as WebAssembly.Global).value=0x1000;
 return {v:new DataView(memory.buffer,0x1000,65536),run:()=> (i.exports.run as Function)(0x8000,0,0)&1};
}
test('BT immediate memory reads the selected bit and leaves memory unchanged',()=>{
 const {v,run}=build('dword ptr [0x2000]','0x1');v.setUint32(0x2000,2,true);expect(run()).toBe(1);expect(v.getUint32(0x2000,true)).toBe(2);v.setUint32(0x2000,4,true);expect(run()).toBe(0);
});
test('BT register index wraps by register width',()=>{
 expect(build('EAX','ECX',[['MOV','EAX, 0x80000000'],['MOV','ECX, 0x3f']]).run()).toBe(1);
 expect(build('AX','CX',[['MOV','EAX, 0x8000'],['MOV','ECX, 0x1f']]).run()).toBe(1);
});
test('BT memory register index selects subsequent and preceding words',()=>{
 for(const [index,address] of [['0x21',0x2004],['0xffffffff',0x1ffc]] as const){const {v,run}=build('dword ptr [0x2000]','ECX',[['MOV',`ECX, ${index}`]]);v.setUint32(address,index==='0x21'?2:0x80000000,true);expect(run()).toBe(1);}
});
