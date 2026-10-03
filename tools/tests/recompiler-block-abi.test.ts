import {test,expect} from 'bun:test';
import {Lifter} from '../recompiler/lifter';
import {RuntimeBridge} from '../recompiler/runtime-bridge';
import type {CFGFunction} from '../recompiler/types';

test('multi-block CALL executes once and RET publishes stdcall stack cleanup', () => {
 const f: CFGFunction={name:'block_caller',entry:'0x1000',rva:'0x1000',size:16,basicBlocks:[
  {start:'0x1000',end:'0x1004',instructions:[{addr:'0x1000',len:5,mnemonic:'CALL',ops:'0x9000'}],destinations:[{addr:'0x1005',type:'FALL_THROUGH'}]},
  {start:'0x1005',end:'0x1007',instructions:[{addr:'0x1005',len:3,mnemonic:'RET',ops:'0x8'}],destinations:[]}
 ]};
 const l=new Lifter({importMemory:true,memoryPages:1});l.prepareModule([f]);l.liftFunction(f);l.moduleBuilder.addExport('caller',0,0);
 const memory=new WebAssembly.Memory({initial:1});const bridge=new RuntimeBridge({memory});
 bridge.registerIatEntry(0x9000,'kernel32','GetTickCount');let calls=0;
 bridge.registerModule('kernel32',{GetTickCount:()=>{calls++;return {value:42,stackCleanup:0};}});
 const instance=new WebAssembly.Instance(new WebAssembly.Module(l.moduleBuilder.toBinary()),bridge.createWasmImports());bridge.registerExports(instance.exports);
 expect((instance.exports.caller as Function)(0x8000,0,0)).toBe(42);
 expect(calls).toBe(1);expect((instance.exports.esp as WebAssembly.Global).value).toBe(0x800c);
});


test('inlined SEH epilog restores caller return slot without popping it twice', () => {
 const f: CFGFunction={name:'seh_caller',entry:'0x2000',rva:'0x2000',size:24,basicBlocks:[{start:'0x2000',end:'0x2017',destinations:[],instructions:[
 {addr:'0x2000',len:2,mnemonic:'PUSH',ops:'0x14'},
 {addr:'0x2002',len:5,mnemonic:'PUSH',ops:'0x9000'},
 {addr:'0x2007',len:5,mnemonic:'CALL',ops:'0x692cc3'},
 {addr:'0x200c',len:3,mnemonic:'MOV',ops:'EAX, dword ptr [EBP + 0x8]'},
 {addr:'0x200f',len:5,mnemonic:'CALL',ops:'0x692d08'},
 {addr:'0x2014',len:3,mnemonic:'RET',ops:'0x4'}]}]};
 const l=new Lifter({importMemory:true,memoryPages:160});l.prepareModule([f]);l.liftFunction(f);l.moduleBuilder.addExport('caller',0,0);
 const memory=new WebAssembly.Memory({initial:160});new DataView(memory.buffer).setUint32(0x8004,0xabc123,true);
 const b=new RuntimeBridge({memory});const i=new WebAssembly.Instance(new WebAssembly.Module(l.moduleBuilder.toBinary()),b.createWasmImports());b.registerExports(i.exports);
 expect((i.exports.caller as Function)(0x8000,0,0)).toBe(0xabc123);
 expect((i.exports.esp as WebAssembly.Global).value).toBe(0x8008);
});

test('external JMP tail-calls the compiled target with the original return slot', () => {
 const callee: CFGFunction={name:'tail_target',entry:'0x3000',rva:'0x3000',size:7,basicBlocks:[{start:'0x3000',end:'0x3006',destinations:[],instructions:[
 {addr:'0x3000',len:4,mnemonic:'MOV',ops:'EAX, dword ptr [ESP + 0x4]'}, {addr:'0x3004',len:3,mnemonic:'RET',ops:'0x8'}]}]};
 const wrapper: CFGFunction={name:'tail_wrapper',entry:'0x4000',rva:'0x4000',size:10,basicBlocks:[
 {start:'0x4000',end:'0x4004',destinations:[],instructions:[{addr:'0x4000',len:5,mnemonic:'JMP',ops:'0x3000'}]},
 {start:'0x4005',end:'0x4009',destinations:[],instructions:[{addr:'0x4005',len:1,mnemonic:'XOR',ops:'EAX, EAX'},{addr:'0x4006',len:1,mnemonic:'RET',ops:''}]}]};
 const l=new Lifter({importMemory:true,memoryPages:1});l.prepareModule([callee,wrapper]);l.liftFunction(callee);l.liftFunction(wrapper);l.moduleBuilder.addExport('caller',0,1);
 const memory=new WebAssembly.Memory({initial:1});const v=new DataView(memory.buffer);v.setUint32(0x8000,0x5555,true);v.setUint32(0x8004,0x123456,true);
 const b=new RuntimeBridge({memory});const i=new WebAssembly.Instance(new WebAssembly.Module(l.moduleBuilder.toBinary()),b.createWasmImports());b.registerExports(i.exports);
 expect((i.exports.caller as Function)(0x8000,0,0)).toBe(0x123456);expect((i.exports.esp as WebAssembly.Global).value).toBe(0x800c);expect(v.getUint32(0x8000,true)).toBe(0x5555);
});

test('single-block JMP register routes to a dynamic API without a second return pop', () => {
 const f: CFGFunction={name:'dynamic_tail',entry:'0x5000',rva:'0x5000',size:2,basicBlocks:[{start:'0x5000',end:'0x5001',destinations:[],instructions:[{addr:'0x5000',len:2,mnemonic:'JMP',ops:'EAX'}]}]};
 const l=new Lifter({importMemory:true,memoryPages:1});l.prepareModule([f]);l.liftFunction(f);l.moduleBuilder.addExport('caller',0,0);
 const memory=new WebAssembly.Memory({initial:1});const b=new RuntimeBridge({memory});const address=b.registerDynamicApi('kernel32','GetTickCount');b.registerModule('kernel32',{GetTickCount:()=>({value:77,stackCleanup:0})});
 const i=new WebAssembly.Instance(new WebAssembly.Module(l.moduleBuilder.toBinary()),b.createWasmImports());b.registerExports(i.exports);
 expect((i.exports.caller as Function)(0x8000,0,address)).toBe(77);expect((i.exports.esp as WebAssembly.Global).value).toBe(0x8004);
});
