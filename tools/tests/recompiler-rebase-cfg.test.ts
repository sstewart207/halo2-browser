import {test,expect} from 'bun:test';
import {rebaseCfg} from '../recompiler/rebase-cfg';
import type {CFGExport} from '../recompiler/types';

function fixture() {
 const pe=Buffer.alloc(0x800);pe.writeUInt32LE(0x80,0x3c);pe.writeUInt16LE(1,0x86);pe.writeUInt16LE(224,0x94);
 const opt=0x98;pe.writeUInt16LE(0x10b,opt);pe.writeUInt32LE(0x10000000,opt+28);pe.writeUInt32LE(0x2000,opt+56);pe.writeUInt32LE(0x200,opt+60);
 pe.writeUInt32LE(0x1200,opt+136);pe.writeUInt32LE(12,opt+140);
 const sec=opt+224;pe.writeUInt32LE(0x1000,sec+12);pe.writeUInt32LE(0x600,sec+16);pe.writeUInt32LE(0x200,sec+20);
 pe.writeUInt32LE(0x1000,0x400);pe.writeUInt32LE(12,0x404);pe.writeUInt16LE(0x3101,0x408);pe.writeUInt32LE(0x10001500,0x301);
 const cfg:CFGExport={program:'test.dll',imageBase:'0x10000000',functions:[{name:'entry',entry:'0x10001100',rva:'0x1100',size:32,basicBlocks:[{start:'0x10001100',end:'0x10001120',destinations:[{addr:'0x10001600',type:'UNCONDITIONAL_CALL'}],instructions:[
  {addr:'0x10001100',len:5,mnemonic:'MOV',ops:'EAX, 0x10001500'},
  {addr:'0x10001110',len:5,mnemonic:'MOV',ops:'ECX, 0x10001500'},
  {addr:'0x10001115',len:5,mnemonic:'CALL',ops:'0x10001600'},
  {addr:'0x1000111a',len:5,mnemonic:'CALL',ops:'0x00401000'}
 ]}]}]};return {cfg,pe};
}

test('PE relocations rebase real pointer operands but preserve pointer-shaped constants',()=>{
 const {cfg,pe}=fixture(),result=rebaseCfg(cfg,pe,0x14000000),f=result.functions[0],b=f.basicBlocks[0];
 expect(f.entry).toBe('0x14001100');expect(f.name).toBe('test_dll_entry');expect(b.destinations[0].addr).toBe('0x14001600');
 expect(b.instructions.map(i=>i.ops)).toEqual(['EAX, 0x14001500','ECX, 0x10001500','0x14001600','0x00401000']);
 expect(cfg.functions[0].entry).toBe('0x10001100');
});

test('ambiguous relocation operands stop the build instead of guessing',()=>{
 const {cfg,pe}=fixture();cfg.functions[0].basicBlocks[0].instructions[0].ops='dword ptr [0x10001500], 0x10001500';
 expect(()=>rebaseCfg(cfg,pe,0x14000000)).toThrow('ambiguous/missing');
});

test('unsupported relocation kinds stop the build',()=>{
 const {cfg,pe}=fixture();pe.writeUInt16LE(0xa101,0x408);
 expect(()=>rebaseCfg(cfg,pe,0x14000000)).toThrow('Unsupported PE relocation type 10');
});
