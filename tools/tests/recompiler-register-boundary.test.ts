import {test, expect} from 'bun:test';
import {Lifter} from '../recompiler/lifter';
import {RuntimeBridge} from '../recompiler/runtime-bridge';
import type {CFGFunction} from '../recompiler/types';

function makeFunction(name: string, entry: number, ops: [string,string][]): CFGFunction {
 return {name,entry:`0x${entry.toString(16)}`,rva:'0x0',size:64,basicBlocks:[{
  start:`0x${entry.toString(16)}`,end:`0x${(entry+63).toString(16)}`,destinations:[],
  instructions:ops.map(([mnemonic,operands],i)=>({addr:`0x${(entry+i*5).toString(16)}`,len:5,mnemonic,ops:operands}))
 }]};
}

test('internal optimized calls inherit EBX and return EDX/ECX register values',()=>{
 const callee=makeFunction('callee',0x1000,[['MOV','EAX, EBX'],['ADD','EAX, ESI'],['MOV','EDX, 0x1234'],['MOV','ECX, 0x5678'],['RET','']]);
 const caller=makeFunction('caller',0x2000,[['MOV','EBX, 40'],['MOV','ESI, 2'],['CALL','0x1000'],['MOV','dword ptr [0x400], EAX'],['MOV','dword ptr [0x404], EDX'],['MOV','dword ptr [0x408], ECX'],['RET','']]);
 const l=new Lifter({importMemory:true,memoryPages:1});l.prepareModule([callee,caller]);l.liftFunction(callee);l.liftFunction(caller);l.moduleBuilder.addExport('caller',0,1);
 const memory=new WebAssembly.Memory({initial:1});const b=new RuntimeBridge({memory});
 const i=new WebAssembly.Instance(new WebAssembly.Module(l.moduleBuilder.toBinary()),b.createWasmImports());b.registerExports(i.exports);
 (i.exports.caller as Function)(0x8000,0,0);const v=new DataView(memory.buffer);
 expect(v.getUint32(0x400,true)).toBe(42);expect(v.getUint32(0x404,true)).toBe(0x1234);expect(v.getUint32(0x408,true)).toBe(0x5678);
});


test('SEH-framed callee restores EBX/ESI/EDI and caller EBP',()=>{
 const callee=makeFunction('seh_callee',0x1000,[['PUSH','0x14'],['PUSH','0x9000'],['CALL','0x692cc3'],['MOV','EBX, 1'],['MOV','ESI, 2'],['MOV','EDI, 3'],['CALL','0x692d08'],['RET','']]);
 const caller=makeFunction('caller',0x2000,[['MOV','EBX, 40'],['MOV','ESI, 50'],['MOV','EDI, 60'],['MOV','EBP, 70'],['CALL','0x1000'],['MOV','dword ptr [0x400], EBX'],['MOV','dword ptr [0x404], ESI'],['MOV','dword ptr [0x408], EDI'],['MOV','dword ptr [0x40c], EBP'],['RET','']]);
 const l=new Lifter({importMemory:true,memoryPages:160});l.prepareModule([callee,caller]);l.liftFunction(callee);l.liftFunction(caller);l.moduleBuilder.addExport('caller',0,1);
 const memory=new WebAssembly.Memory({initial:160});const b=new RuntimeBridge({memory});
 const i=new WebAssembly.Instance(new WebAssembly.Module(l.moduleBuilder.toBinary()),b.createWasmImports());b.registerExports(i.exports);
 (i.exports.caller as Function)(0x8000,0,0);const v=new DataView(memory.buffer);
 expect([0x400,0x404,0x408,0x40c].map(a=>v.getUint32(a,true))).toEqual([40,50,60,70]);
 expect((i.exports.esp as WebAssembly.Global).value).toBe(0x8004);
});
