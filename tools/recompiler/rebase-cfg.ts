import type {CFGExport} from './types';

/** Rebase disassembly using PE HIGHLOW relocation records, not pointer-shaped guesses. */
export function rebaseCfg(cfg: CFGExport, pe: Buffer, targetBase: number): CFGExport {
 const nt=pe.readUInt32LE(0x3c), opt=nt+24;
 if(pe.readUInt16LE(opt)!==0x10b) throw new Error('CFG rebasing requires PE32');
 const base=pe.readUInt32LE(opt+28), size=pe.readUInt32LE(opt+56), delta=targetBase-base;
 if(parseInt(cfg.imageBase,16)!==base) throw new Error('CFG and PE image bases differ');
 const sectionCount=pe.readUInt16LE(nt+6), table=opt+pe.readUInt16LE(nt+20);
 const rawOffset=(rva:number):number=>{
  if(rva<pe.readUInt32LE(opt+60))return rva;
  for(let i=0;i<sectionCount;i++){
   const p=table+i*40, start=pe.readUInt32LE(p+12), rawSize=pe.readUInt32LE(p+16);
   if(rva>=start&&rva<start+rawSize)return pe.readUInt32LE(p+20)+rva-start;
  }
  throw new Error(`RVA has no file bytes: 0x${rva.toString(16)}`);
 };
 const relocs=new Map<number,number>();
 const relocRva=pe.readUInt32LE(opt+136), relocSize=pe.readUInt32LE(opt+140);
 if(delta && !relocRva)throw new Error('Image has no relocations');
 for(let used=0;used<relocSize;){
  const p=rawOffset(relocRva+used), page=pe.readUInt32LE(p), length=pe.readUInt32LE(p+4);
  if(length<8 || used+length>relocSize || length%2)throw new Error('Invalid relocation block');
  for(let j=8;j<length;j+=2){
   const record=pe.readUInt16LE(p+j), type=record>>>12;
   if(!type)continue;
   if(type!==3)throw new Error(`Unsupported PE relocation type ${type}`);
   const rva=page+(record&0xfff);relocs.set(base+rva,pe.readUInt32LE(rawOffset(rva)));
  }
  used+=length;
 }
 const address=(s:string)=>`0x${((parseInt(s,16)+delta)>>>0).toString(16)}`;
 const controlAddress=(s:string)=>{const n=parseInt(s,16);return n>=base&&n<base+size?address(s):s;};
 const out=structuredClone(cfg);out.imageBase=`0x${targetBase.toString(16)}`;
 for(const f of out.functions){
  f.name=`${cfg.program.replace(/\W/g,'_')}_${f.name}`;f.entry=address(f.entry);
  for(const b of f.basicBlocks){
   b.start=address(b.start);b.end=address(b.end);
   for(const d of b.destinations)d.addr=controlAddress(d.addr);
   for(const i of b.instructions){
    const pc=parseInt(i.addr,16);
    for(let p=pc;p<pc+i.len;p++){
     const original=relocs.get(p);if(original===undefined)continue;
     let matches=0;
     i.ops=i.ops.replace(/0x[0-9a-f]+/gi,token=>{
      if(parseInt(token,16)!==original)return token;
      matches++;return `0x${((original+delta)>>>0).toString(16)}`;
     });
     if(matches!==1)throw new Error(`Relocated operand ambiguous/missing at 0x${pc.toString(16)}`);
    }
    if(/^(CALL|J\w+)$/.test(i.mnemonic)&&/^0x[0-9a-f]+$/i.test(i.ops))i.ops=controlAddress(i.ops);
    i.addr=address(i.addr);
   }
  }
 }
 return out;
}
