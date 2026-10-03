import {test,expect} from 'bun:test';
import {Lifter} from '../recompiler/lifter';
import {RuntimeBridge} from '../recompiler/runtime-bridge';
import type {CFGFunction} from '../recompiler/types';
function fn(name:string,entry:number,ops:string[][]):CFGFunction {
 return {name,entry:`0x${entry.toString(16)}`,rva:'0',size:ops.length,basicBlocks:[{start:`0x${entry.toString(16)}`,end:`0x${(entry+ops.length).toString(16)}`,instructions:ops.map(([mnemonic,ops],n)=>({addr:`0x${(entry+n).toString(16)}`,len:1,mnemonic,ops})),destinations:[]}]};
}
function build(ops:string[][],callee?:CFGFunction){
 const funcs=[fn('run',0x1000,ops),...(callee?[callee]:[])];const l=new Lifter({importMemory:true,memoryPages:2});l.prepareModule(funcs);funcs.forEach((f,n)=>{l.liftFunction(f);l.moduleBuilder.addExport(f.name,0,n);});
 const memory=new WebAssembly.Memory({initial:2});const b=new RuntimeBridge({memory,memoryOffset:0x1000,memoryLength:65536});
 const i=new WebAssembly.Instance(new WebAssembly.Module(l.moduleBuilder.toBinary()),b.createWasmImports());b.registerExports(i.exports);(i.exports.guest_memory_base as WebAssembly.Global).value=0x1000;
 return {i,v:new DataView(memory.buffer,0x1000,65536),run:()=> (i.exports.run as Function)(0x8000,0,0)};
}
const bits=[0x7fa12345,0x89abcdef,0x80000000,0x12345678];
test('CVTDQ2PD snapshots signed low integers before aliased binary64 writes',()=>{
 for(const source of ['XMM0','qword ptr [0x2000]']){
  const {v,run}=build([['MOVDQU','XMM0, xmmword ptr [0x2000]'],['CVTDQ2PD',`XMM0, ${source}`],['MOVDQU','xmmword ptr [0x2040], XMM0'],['RET','']]);
  v.setInt32(0x2000,-2147483648,true);v.setInt32(0x2004,2147483647,true);run();
  expect(v.getFloat64(0x2040,true)).toBe(-2147483648);expect(v.getFloat64(0x2048,true)).toBe(2147483647);
 }
});
test('ADDSD preserves upper binary64 while converting unsigned maximum; CVTPD2PS clears upper lanes',()=>{
 const {v,run}=build([['MOVDQU','XMM0, xmmword ptr [0x2000]'],['CVTDQ2PD','XMM0, XMM0'],['ADDSD','XMM0, qword ptr [0x2020]'],['MOVDQU','xmmword ptr [0x2040], XMM0'],['CVTPD2PS','XMM0, XMM0'],['MOVDQU','xmmword ptr [0x2060], XMM0'],['RET','']]);
 v.setInt32(0x2000,-1,true);v.setInt32(0x2004,17,true);v.setFloat64(0x2020,4294967296,true);run();
 expect(v.getFloat64(0x2040,true)).toBe(4294967295);expect(v.getFloat64(0x2048,true)).toBe(17);
 expect(v.getFloat32(0x2060,true)).toBe(Math.fround(4294967295));expect(v.getFloat32(0x2064,true)).toBe(17);
 expect(v.getUint32(0x2068,true)).toBe(0);expect(v.getUint32(0x206c,true)).toBe(0);
});
test('CVTPD2PS memory conversion rounds to nearest even and preserves signed zero',()=>{
 const {v,run}=build([['CVTPD2PS','XMM0, xmmword ptr [0x2000]'],['MOVDQU','xmmword ptr [0x2040], XMM0'],['RET','']]);
 v.setFloat64(0x2000,1+2**-24,true);v.setFloat64(0x2008,-0,true);run();
 expect(v.getFloat32(0x2040,true)).toBe(1);expect(v.getUint32(0x2044,true)).toBe(0x80000000);
});
test('CMOVA and signed conditional moves distinguish ordering and equality',()=>{
 for(const [op,left,right,selected] of [['CMOVA','0x201','0x200',true],['CMOVA','0x200','0x200',false],['CMOVA','0x1','0xffffffff',false],['CMOVB','0x1','0xffffffff',true],['CMOVL','0xffffffff','0x1',true],['CMOVGE','0xffffffff','0x1',false]] as const){
  const {run}=build([['MOV',`ECX, ${left}`],['MOV',`EDX, ${right}`],['CMP','ECX, EDX'],['MOV','EAX, 0x7'],['MOV','EDX, 0x9'],[op,'EAX, EDX'],['RET','']]);expect(run()).toBe(selected?9:7);
 }
});
test('PSHUFD snapshots aliased source before permuting or broadcasting lanes',()=>{
 for(const [control,expected] of [['0x1b',[...bits].reverse()],['0x0',Array(4).fill(bits[0])]] as const){
  const {v,run}=build([['MOVDQU','XMM0, xmmword ptr [0x2000]'],['PSHUFD',`XMM0, XMM0, ${control}`],['MOVDQU','xmmword ptr [0x2040], XMM0'],['RET','']]);bits.forEach((x,n)=>v.setUint32(0x2000+4*n,x,true));run();expect([0,1,2,3].map(n=>v.getUint32(0x2040+4*n,true))).toEqual(expected);
 }
});
test('CMOVZ selects only on zero and preserves comparison flags',()=>{
 for(const zero of [false,true]) {
  const {run}=build([['MOV','EAX, 0x7'],['MOV','EDX, 0x9'],['CMP',zero?'EAX, EAX':'EAX, EDX'],['CMOVZ','EAX, EDX'],['CMOVNZ','EAX, EDX'],['RET','']]);expect(run()).toBe(9);
  const {run:single}=build([['MOV','EAX, 0x7'],['MOV','EDX, 0x9'],['CMP',zero?'EAX, EAX':'EAX, EDX'],['CMOVZ','EAX, EDX'],['RET','']]);expect(single()).toBe(zero?9:7);
 }
});
test('XCHG addresses memory before replacing its base register and preserves flags',()=>{
 const {v,run}=build([['MOV','EAX, 0x2000'],['CMP','EAX, EAX'],['XCHG','EAX, dword ptr [EAX]'],['PUSHFD',''],['POP','EDX'],['MOV','dword ptr [0x2040], EDX'],['RET','']]);
 v.setUint32(0x2000,0x12345678,true);expect(run()).toBe(0x12345678);expect(v.getUint32(0x2000,true)).toBe(0x2000);expect(v.getUint32(0x2040,true)&0x40).toBe(0x40);
});
test('MOVLPD copies exactly 64 bits, preserves upper XMM lanes and neighboring memory',()=>{
 const {v,run}=build([['MOVDQU','XMM0, xmmword ptr [0x2000]'],['MOVLPD','XMM0, qword ptr [0x2020]'],['MOVLPD','qword ptr [0x2040], XMM0'],['MOVDQU','xmmword ptr [0x2060], XMM0'],['RET','']]);
 bits.forEach((x,n)=>v.setUint32(0x2000+n*4,x,true));v.setUint32(0x2020,0xfedcba98,true);v.setUint32(0x2024,0x7ff12345,true);v.setUint32(0x2048,0xcafebabe,true);run();
 expect(v.getUint32(0x2040,true)).toBe(0xfedcba98);expect(v.getUint32(0x2044,true)).toBe(0x7ff12345);expect(v.getUint32(0x2048,true)).toBe(0xcafebabe);
 expect([0,1,2,3].map(n=>v.getUint32(0x2060+n*4,true))).toEqual([0xfedcba98,0x7ff12345,bits[2],bits[3]]);
});
test('full XMM bits survive calls and XORPS handles different registers',()=>{
 const {v,run}=build([['MOVUPS','XMM0, xmmword ptr [0x2000]'],['CALL','0x1100'],['MOVAPS','xmmword ptr [0x2040], XMM0'],['RET','']],fn('callee',0x1100,[['MOVAPD','XMM1, XMM0'],['MOVD','XMM2, EAX'],['XORPS','XMM1, XMM2'],['MOVDQA','XMM0, XMM1'],['RET','']]));
 bits.forEach((x,n)=>v.setUint32(0x2000+n*4,x,true));run();expect([0,1,2,3].map(n=>v.getUint32(0x2040+n*4,true))).toEqual(bits);
});
test('MOVSS register move preserves upper lanes; memory load clears them',()=>{
 const {v,run}=build([['MOVUPS','XMM0, xmmword ptr [0x2000]'],['MOVD','XMM1, EAX'],['MOVSS','XMM0, XMM1'],['MOVUPS','xmmword ptr [0x2040], XMM0'],['MOVSS','XMM0, dword ptr [0x2000]'],['MOVUPS','xmmword ptr [0x2060], XMM0'],['RET','']]);
 bits.forEach((x,n)=>v.setUint32(0x2000+n*4,x,true));run();expect([0,1,2,3].map(n=>v.getUint32(0x2040+n*4,true))).toEqual([0,...bits.slice(1)]);expect([0,1,2,3].map(n=>v.getUint32(0x2060+n*4,true))).toEqual([bits[0],0,0,0]);
});
test('XORPS computes all four lanes rather than always zeroing',()=>{
 const {v,run}=build([['MOVDQU','XMM0, xmmword ptr [0x2000]'],['MOVDQU','XMM1, xmmword ptr [0x2020]'],['XORPS','XMM0, XMM1'],['MOVDQU','xmmword ptr [0x2040], XMM0'],['RET','']]);
 bits.forEach((x,n)=>{v.setUint32(0x2000+n*4,x,true);v.setUint32(0x2020+n*4,0x11223344,true);});run();expect([0,1,2,3].map(n=>v.getUint32(0x2040+n*4,true))).toEqual(bits.map(x=>(x^0x11223344)>>>0));
});
