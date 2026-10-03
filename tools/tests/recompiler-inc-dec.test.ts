import {test,expect} from 'bun:test';
import {Lifter} from '../recompiler/lifter';
import {RuntimeBridge} from '../recompiler/runtime-bridge';
import type {CFGFunction} from '../recompiler/types';
function run(mnemonic:string,size:number,initial:number){
 const prefix=size===1?'byte':size===2?'word':'dword';
 const ops=[['PUSH','0x203'],['POPFD',''],[mnemonic,`${prefix} ptr [0x2000]`],['PUSHFD',''],['POP','EAX'],['RET','']];
 const f:CFGFunction={name:'run',entry:'0x1000',rva:'0',size:6,basicBlocks:[{start:'0x1000',end:'0x1005',instructions:ops.map(([mnemonic,ops],n)=>({addr:`0x${(0x1000+n).toString(16)}`,len:1,mnemonic,ops})),destinations:[]}]};
 const l=new Lifter({importMemory:true,memoryPages:2});l.prepareModule([f]);l.liftFunction(f);l.moduleBuilder.addExport('run',0,0);
 const memory=new WebAssembly.Memory({initial:2});const b=new RuntimeBridge({memory,memoryOffset:0x1000,memoryLength:65536});const i=new WebAssembly.Instance(new WebAssembly.Module(l.moduleBuilder.toBinary()),b.createWasmImports());b.registerExports(i.exports);(i.exports.guest_memory_base as WebAssembly.Global).value=0x1000;
 const v=new DataView(memory.buffer,0x1000,65536);v.setUint32(0x2000,initial,true);v.setUint32(0x2004,0xcafebabe,true);
 const flags=(i.exports.run as Function)(0x8000,0,0);return {flags,value:v.getUint32(0x2000,true),neighbor:v.getUint32(0x2004,true)};
}
test('locked INC wraps at operand width, updates zero/parity/auxiliary flags and preserves carry',()=>{
 for(const size of [1,2,4]){const mask=size===4?0xffffffff:2**(size*8)-1;const r=run('INC.LOCK',size,mask);expect(r.value).toBe(0);expect(r.flags&0x8d5).toBe(0x55);expect(r.neighbor).toBe(0xcafebabe);}
});
test('INC signed overflow and DEC signed overflow set the correct sign and retain carry',()=>{
 for(const size of [1,2,4]){const sign=2**(size*8-1);const inc=run('INC',size,sign-1);expect(inc.value).toBe(sign);expect(inc.flags&0x881).toBe(0x881);const dec=run('DEC.LOCK',size,sign);expect(dec.value).toBe(sign-1);expect(dec.flags&0x881).toBe(0x801);}
});
test('byte INC updates only its byte and sets odd parity correctly',()=>{
 const r=run('INC.LOCK',1,0x12345602);expect(r.value).toBe(0x12345603);expect(r.flags&5).toBe(5);
 const odd=run('INC',1,0);expect(odd.flags&5).toBe(1);
});
