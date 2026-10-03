import {test, expect} from 'bun:test';
import {Lifter} from '../recompiler/lifter';
import {RuntimeBridge} from '../recompiler/runtime-bridge';
import type {CFGFunction} from '../recompiler/types';

function buildFn(name: string, instructions: Array<[string, string]>) {
    const ins = (addr: number, mnemonic: string, ops: string) => ({
        addr: `0x${addr.toString(16)}`,
        len: 1,
        mnemonic,
        ops
    });
    const f: CFGFunction = {
        name,
        entry: '0x1000',
        rva: '0x1000',
        size: instructions.length,
        basicBlocks: [
            {
                start: '0x1000',
                end: `0x${(0x1000 + instructions.length).toString(16)}`,
                instructions: instructions.map(([m, ops], idx) => ins(0x1000 + idx, m, ops)),
                destinations: []
            }
        ]
    };
    const lifter = new Lifter({importMemory: true, memoryPages: 1});
    lifter.prepareModule([f]);
    lifter.liftFunction(f);
    lifter.moduleBuilder.addExport(name, 0, 0);
    const memory = new WebAssembly.Memory({initial: 1});
    const bridge = new RuntimeBridge({memory});
    const instance = new WebAssembly.Instance(
        new WebAssembly.Module(lifter.moduleBuilder.toBinary()),
        bridge.createWasmImports()
    );
    const view = new DataView(memory.buffer);
    return {instance, bridge, view};
}

test('STOSB.REP fills buffer with byte value', () => {
    // EAX=0xaa, ECX=5, EDI=0x2000; STOSB.REP; RET
    const {instance, view} = buildFn('test_stosb', [
        ['MOV', 'EAX, 0xaa'],
        ['MOV', 'ECX, 0x5'],
        ['MOV', 'EDI, 0x2000'],
        ['STOSB.REP', ''],
        ['RET', '']
    ]);
    (instance.exports.test_stosb as Function)(0x8000, 0, 0);
    for (let offset = 0; offset < 5; offset++) {
        expect(view.getUint8(0x2000 + offset)).toBe(0xaa);
    }
    expect(view.getUint8(0x2005)).toBe(0); // untouched
});

test('MOVSB.REP copies bytes from ESI to EDI', () => {
    const {instance, view} = buildFn('test_movsb', [
        ['MOV', 'ESI, 0x3000'],
        ['MOV', 'EDI, 0x4000'],
        ['MOV', 'ECX, 0x4'],
        ['MOVSB.REP', ''],
        ['RET', '']
    ]);
    view.setUint32(0x3000, 0x12345678, true);
    (instance.exports.test_movsb as Function)(0x8000, 0, 0);
    expect(view.getUint32(0x4000, true)).toBe(0x12345678);
});

test('SCASB.REPNE finds byte and sets ZF', () => {
    // Search for 0x00 in string "HELLO\0" at 0x5000
    const {instance, view} = buildFn('test_scasb', [
        ['MOV', 'EDI, 0x5000'],
        ['MOV', 'ECX, 0xa'],
        ['XOR', 'EAX, EAX'], // AL = 0
        ['SCASB.REPNE', ''],
        ['SETZ', 'AL'],
        ['RET', '']
    ]);
    const str = 'HELLO\0WORLD';
    for (let i = 0; i < str.length; i++) view.setUint8(0x5000 + i, str.charCodeAt(i));
    const zf = (instance.exports.test_scasb as Function)(0x8000, 0, 0) & 0xff;
    expect(zf).toBe(1);
});

for (const backwards of [false, true]) test(`CMPSB.REPE compares until mismatch with DF=${backwards ? 1 : 0}`, () => {
 const {instance,view}=buildFn('compare_bytes',[
  ['MOV',`ESI, ${backwards?'0x3002':'0x3000'}`],
  ['MOV',`EDI, ${backwards?'0x4002':'0x4000'}`],
  ['MOV','ECX, 3'],[backwards?'STD':'CLD',''],['CMPSB.REPE','ES:EDI, ESI'],
  ['SETZ','AL'],['MOV','dword ptr [0x5000], ESI'],['MOV','dword ptr [0x5004], EDI'],['MOV','dword ptr [0x5008], ECX'],['RET','']
 ]);
 [1,2,3].forEach((x,i)=>{view.setUint8(0x3000+i,x);view.setUint8(0x4000+i,x);});
 view.setUint8(backwards?0x4000:0x4002,9);
 const result=(instance.exports.compare_bytes as Function)(0x8000,0,0);
 expect(result&0xff).toBe(0);
 expect(view.getUint32(0x5008,true)).toBe(0);
 expect(view.getUint32(0x5000,true)).toBe(backwards?0x2fff:0x3003);
 expect(view.getUint32(0x5004,true)).toBe(backwards?0x3fff:0x4003);
});

test('zero-count CMPSB.REPE preserves the prior comparison flags',()=>{
 const {instance,view}=buildFn('compare_none',[
  ['MOV','ESI, 0x3000'],['MOV','EDI, 0x4000'],['CMP','EAX, EAX'],['MOV','ECX, 0'],
  ['CMPSB.REPE','ES:EDI, ESI'],['SETZ','AL'],['RET','']
 ]);
 expect((instance.exports.compare_none as Function)(0x8000,0,7)&0xff).toBe(1);
 expect(view.getUint8(0x3000)).toBe(0);
});


for (const backwards of [false,true]) test(`MOVSD.REP copies dwords with DF=${backwards?1:0}`,()=>{
 const {instance,view}=buildFn('copy_dwords',[
  ['MOV',`ESI, ${backwards?'0x3008':'0x3000'}`],['MOV',`EDI, ${backwards?'0x4008':'0x4000'}`],['MOV','ECX, 3'],
  [backwards?'STD':'CLD',''],['MOVSD.REP','ES:EDI, ESI'],['MOV','dword ptr [0x5000], ESI'],['MOV','dword ptr [0x5004], EDI'],['MOV','dword ptr [0x5008], ECX'],['RET','']
 ]);
 [1,2,3].forEach((value,i)=>view.setUint32(0x3000+i*4,value,true));
 (instance.exports.copy_dwords as Function)(0x8000,0,0);
 expect([0,4,8].map(n=>view.getUint32(0x4000+n,true))).toEqual([1,2,3]);
 expect(view.getUint32(0x5000,true)).toBe(backwards?0x2ffc:0x300c);expect(view.getUint32(0x5004,true)).toBe(backwards?0x3ffc:0x400c);expect(view.getUint32(0x5008,true)).toBe(0);
});

test('zero-count REP MOVSD leaves memory and pointers untouched',()=>{
 const {instance,view}=buildFn('copy_none',[['MOV','ESI, 0x3000'],['MOV','EDI, 0x4000'],['XOR','ECX, ECX'],['MOVSD.REP','ES:EDI, ESI'],['MOV','EAX, ESI'],['RET','']]);
 view.setUint32(0x3000,42,true);expect((instance.exports.copy_none as Function)(0x8000,0,0)).toBe(0x3000);expect(view.getUint32(0x4000,true)).toBe(0);
});

test('single MOVSD preserves flags and ECX while moving one dword',()=>{
 const {instance,view}=buildFn('copy_one',[['MOV','ESI, 0x3000'],['MOV','EDI, 0x4000'],['MOV','ECX, 9'],['CMP','ECX, 9'],['MOVSD','ES:EDI, ESI'],['SETZ','AL'],['MOV','dword ptr [0x5000], ECX'],['RET','']]);
 view.setUint32(0x3000,0xabc123,true);expect((instance.exports.copy_one as Function)(0x8000,0,0)&255).toBe(1);expect(view.getUint32(0x4000,true)).toBe(0xabc123);expect(view.getUint32(0x5000,true)).toBe(9);
});
