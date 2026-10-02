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

