import {test,expect} from 'bun:test';
import {Lifter} from '../recompiler/lifter';import {RuntimeBridge} from '../recompiler/runtime-bridge';import type {CFGFunction} from '../recompiler/types';
function compare(jump:string,lhs:number,rhs:number,size='EAX, ECX') {
 const ins=(addr:string,mnemonic:string,ops:string)=>({addr,len:1,mnemonic,ops});
 const f:CFGFunction={name:'compare',entry:'0x1000',rva:'0x1000',size:10,basicBlocks:[
 {start:'0x1000',end:'0x1001',instructions:[ins('0x1000','CMP',size),ins('0x1001',jump,'0x1004')],destinations:[{addr:'0x1004',type:'CONDITIONAL_JUMP'},{addr:'0x1002',type:'FALL_THROUGH'}]},
 {start:'0x1002',end:'0x1003',instructions:[ins('0x1002','MOV','EAX, 0x0'),ins('0x1003','RET','')],destinations:[]},
 {start:'0x1004',end:'0x1005',instructions:[ins('0x1004','MOV','EAX, 0x1'),ins('0x1005','RET','')],destinations:[]}]};
 const l=new Lifter({importMemory:true,memoryPages:1});l.prepareModule([f]);l.liftFunction(f);l.moduleBuilder.addExport('compare',0,0);
 const b=new RuntimeBridge({memory:new WebAssembly.Memory({initial:1})});const i=new WebAssembly.Instance(new WebAssembly.Module(l.moduleBuilder.toBinary()),b.createWasmImports());return (i.exports.compare as Function)(0x8000,rhs,lhs);
}
test('CMP unsigned borrow makes small allocation sizes less than 0xffffffe0',()=>{expect(compare('JB',532,-32)).toBe(1);expect(compare('JA',532,-32)).toBe(0);expect(compare('JAE',-32,532)).toBe(1);expect(compare('JBE',532,532)).toBe(1);});
test('CMP signed branches account for subtraction overflow',()=>{expect(compare('JL',-2147483648,1)).toBe(1);expect(compare('JG',2147483647,-1)).toBe(1);expect(compare('JGE',-2147483648,1)).toBe(0);});
test('CMP byte and word flags use their operand width',()=>{expect(compare('JB',0x100,0xff,'AL, CL')).toBe(1);expect(compare('JL',0x80,1,'AL, CL')).toBe(1);expect(compare('JL',0x8000,1,'AX, CX')).toBe(1);expect(compare('JE',0x10000,0,'AX, CX')).toBe(1);});
