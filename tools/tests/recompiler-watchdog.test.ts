import {test,expect} from 'bun:test';
import {Lifter} from '../recompiler/lifter';
import {RuntimeBridge} from '../recompiler/runtime-bridge';
import type {CFGFunction} from '../recompiler/types';
test('optional watchdog stops a guest loop and identifies its block',()=>{
 const f:CFGFunction={name:'loop',entry:'0x1000',rva:'0x1000',size:3,basicBlocks:[
 {start:'0x1000',end:'0x1000',instructions:[{addr:'0x1000',len:1,mnemonic:'JMP',ops:'0x1001'}],destinations:[{addr:'0x1001',type:'UNCONDITIONAL_JUMP'}]},
 {start:'0x1001',end:'0x1001',instructions:[{addr:'0x1001',len:1,mnemonic:'JMP',ops:'0x1001'}],destinations:[{addr:'0x1001',type:'UNCONDITIONAL_JUMP'}]}]};
 const l=new Lifter({importMemory:true,memoryPages:1,debugBlockLimit:5});l.prepareModule([f]);l.liftFunction(f);l.moduleBuilder.addExport('loop',0,0);
 const b=new RuntimeBridge({memory:new WebAssembly.Memory({initial:1})});const i=new WebAssembly.Instance(new WebAssembly.Module(l.moduleBuilder.toBinary()),b.createWasmImports());
 expect(()=> (i.exports.loop as Function)(0x8000,0,0)).toThrow();
 expect((i.exports.aot_debug_fuel as WebAssembly.Global).value).toBe(0);
 expect((i.exports.aot_debug_pc as WebAssembly.Global).value).toBe(0x1001);
});

test('unsupported counter branch traps instead of looping unconditionally',()=>{
 const f:CFGFunction={name:'parity',entry:'0x1000',rva:'0x1000',size:3,basicBlocks:[
 {start:'0x1000',end:'0x1000',instructions:[{addr:'0x1000',len:1,mnemonic:'JECXZ',ops:'0x1000'}],destinations:[{addr:'0x1000',type:'CONDITIONAL_JUMP'},{addr:'0x1001',type:'FALL_THROUGH'}]},
 {start:'0x1001',end:'0x1001',instructions:[{addr:'0x1001',len:1,mnemonic:'RET',ops:''}],destinations:[]}]};
 const l=new Lifter({importMemory:true,memoryPages:1});l.prepareModule([f]);l.liftFunction(f);l.moduleBuilder.addExport('parity',0,0);
 const b=new RuntimeBridge({memory:new WebAssembly.Memory({initial:1})});const i=new WebAssembly.Instance(new WebAssembly.Module(l.moduleBuilder.toBinary()),b.createWasmImports());
 expect(()=> (i.exports.parity as Function)(0x8000,0,0)).toThrow('unreachable');
});

test('unsupported instruction records its address and stops instead of skipping it',()=>{
 const f:CFGFunction={name:'unsupported',entry:'0x1234',rva:'0x1234',size:2,basicBlocks:[{start:'0x1234',end:'0x1235',instructions:[
 {addr:'0x1234',len:1,mnemonic:'FCOMPP',ops:''},{addr:'0x1235',len:1,mnemonic:'RET',ops:''}],destinations:[]}]};
 const l=new Lifter({importMemory:true,memoryPages:1});l.prepareModule([f]);l.liftFunction(f);l.moduleBuilder.addExport('unsupported',0,0);
 const b=new RuntimeBridge({memory:new WebAssembly.Memory({initial:1})});const i=new WebAssembly.Instance(new WebAssembly.Module(l.moduleBuilder.toBinary()),b.createWasmImports());
 expect(()=> (i.exports.unsupported as Function)(0x8000,0,0)).toThrow();
 expect((i.exports.aot_unsupported_pc as WebAssembly.Global).value).toBe(0x1234);
});

test('LEAVE restores the saved frame before RET publishes ESP',()=>{
 const instructions=[['PUSH','EBP'],['MOV','EBP, ESP'],['SUB','ESP, 0x20'],['MOV','EAX, 0x7'],['LEAVE',''],['RET','']].map(([mnemonic,ops],n)=>({addr:'0x'+(0x1000+n).toString(16),len:1,mnemonic,ops}));
 const f:CFGFunction={name:'frame',entry:'0x1000',rva:'0x1000',size:6,basicBlocks:[{start:'0x1000',end:'0x1005',instructions,destinations:[]}]};
 const l=new Lifter({importMemory:true,memoryPages:1});l.prepareModule([f]);l.liftFunction(f);l.moduleBuilder.addExport('frame',0,0);
 const b=new RuntimeBridge({memory:new WebAssembly.Memory({initial:1})});const i=new WebAssembly.Instance(new WebAssembly.Module(l.moduleBuilder.toBinary()),b.createWasmImports());
 expect((i.exports.frame as Function)(0x8000,0,0)).toBe(7);expect((i.exports.esp as WebAssembly.Global).value).toBe(0x8004);
});

test('unsupported AVX with YMM operands compiles to an explicit PC trap',()=>{
 const f:CFGFunction={name:'avx',entry:'0x1234',rva:'0x1234',size:2,basicBlocks:[{start:'0x1234',end:'0x1235',instructions:[{addr:'0x1234',len:1,mnemonic:'VMOVDQU',ops:'YMM0, ymmword ptr [EAX]'},{addr:'0x1235',len:1,mnemonic:'RET',ops:''}],destinations:[]}]};
 const l=new Lifter({importMemory:true,memoryPages:1});l.prepareModule([f]);l.liftFunction(f);l.moduleBuilder.addExport('avx',0,0);
 const b=new RuntimeBridge({memory:new WebAssembly.Memory({initial:1})});const i=new WebAssembly.Instance(new WebAssembly.Module(l.moduleBuilder.toBinary()),b.createWasmImports());
 expect(()=> (i.exports.avx as Function)(0x8000,0,0)).toThrow('unreachable');
 expect((i.exports.aot_unsupported_pc as WebAssembly.Global).value).toBe(0x1234);
});
