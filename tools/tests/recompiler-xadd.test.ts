import {test,expect} from 'bun:test';
import {Lifter} from '../recompiler/lifter';
import {RuntimeBridge} from '../recompiler/runtime-bridge';
import type {CFGFunction} from '../recompiler/types';

test('locked reference counter increment stores sum and returns previous value',()=>{
 const f:CFGFunction={name:'counter',entry:'0x1000',rva:'0x1000',size:4,basicBlocks:[{start:'0x1000',end:'0x1003',instructions:[
 {addr:'0x1000',len:1,mnemonic:'MOV',ops:'EDX, 0x1'},
 {addr:'0x1001',len:1,mnemonic:'XADD.LOCK',ops:'dword ptr [ECX], EDX'},
 {addr:'0x1002',len:1,mnemonic:'MOV',ops:'EAX, EDX'},
 {addr:'0x1003',len:1,mnemonic:'RET',ops:''}],destinations:[]}]};
 const l=new Lifter({importMemory:true,memoryPages:1});l.prepareModule([f]);l.liftFunction(f);l.moduleBuilder.addExport('counter',0,0);
 const memory=new WebAssembly.Memory({initial:1});const v=new DataView(memory.buffer);v.setUint32(0x2000,41,true);
 const b=new RuntimeBridge({memory});const i=new WebAssembly.Instance(new WebAssembly.Module(l.moduleBuilder.toBinary()),b.createWasmImports());
 expect((i.exports.counter as Function)(0x8000,0x2000,0)).toBe(41);expect(v.getUint32(0x2000,true)).toBe(42);
 v.setUint32(0x2000,0xffffffff,true);expect((i.exports.counter as Function)(0x8000,0x2000,0)).toBe(-1);expect(v.getUint32(0x2000,true)).toBe(0);
});
