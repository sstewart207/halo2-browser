import {test,expect} from 'bun:test';
import {Advapi32} from '../../src/worker/modules/advapi32';
import {System} from '../../src/worker/core/system';
import {Mem} from '../../src/worker/core/memory/mem-accessor';

test('wide crypto context and real SHA-256 honor names, buffers, snapshots and lifecycle',async()=>{
 const mem=new Uint8Array(4096),view=new DataView(mem.buffer),objects=new Map<number,any>();let lastError=0,nextHandle=9000;
 const provider={registerKernelObject:(o:any)=>{const h=++nextHandle;objects.set(h,o);return h;},getKernelObject:(h:number)=>objects.get(h),unregisterKernelObject:(h:number)=>objects.delete(h)};
 const oldSystem=System.getInstance,oldMem={memoryGetter:(Mem as any).memoryGetter,validateRange:(Mem as any).validateRange,getRegion:(Mem as any).getRegion};
 System.getInstance=()=>({scheduler:{setLastError:(n:number)=>{lastError=n;}}}) as any;Mem.bind(()=>mem);
 try{
  const module=new Advapi32();module.initialize({resourceProvider:provider} as any);
  for(const [address,name] of [[0x100,'测试'],[0x200,'Provider Ω']] as const){[...name,'\0'].forEach((c,n)=>view.setUint16(address+n*2,c.charCodeAt(0),true));}
  const result=module.exports.CryptAcquireContextW({} as any,mem,[0x40,0x100,0x200,1,0xf0000000]) as any;
  expect(result).toEqual({value:1,stackCleanup:20});expect(view.getUint32(0x40,true)).toBe(9001);expect(objects.get(9001)).toMatchObject({kind:'crypt_prov',container:'测试',provider:'Provider Ω',provType:1,flags:0xf0000000});expect(lastError).toBe(0);
  expect(module.exports.CryptReleaseContext({} as any,mem,[9001,0])).toEqual({value:1,stackCleanup:8});expect(objects.size).toBe(0);
  expect(module.exports.CryptAcquireContextW({} as any,mem,[0,0,0,1,0])).toEqual({value:0,stackCleanup:20});expect(lastError).toBe(87);expect(objects.size).toBe(0);
  const call=async(name:string,args:number[])=>await module.exports[name]({} as any,mem,args) as any;
  await call('CryptAcquireContextA',[0x40,0,0,24,0xf0000000]);const context=view.getUint32(0x40,true);
  for(const [message,expected] of [['','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],['abc','ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad']] as const){
   expect(await call('CryptCreateHash',[context,0x800c,0,0,0x44])).toEqual({value:1,stackCleanup:20});const hash=view.getUint32(0x44,true);
   if(message){mem.set(new TextEncoder().encode(message),0x300);expect((await call('CryptHashData',[hash,0x300,1,0])).value).toBe(1);expect((await call('CryptHashData',[hash,0x301,2,0])).value).toBe(1);mem.fill(0,0x300,0x303);}
   view.setUint32(0x48,0,true);expect((await call('CryptGetHashParam',[hash,2,0,0x48,0])).value).toBe(1);expect(view.getUint32(0x48,true)).toBe(32);
   view.setUint32(0x48,4,true);expect((await call('CryptGetHashParam',[hash,4,0x380,0x48,0])).value).toBe(1);expect(view.getUint32(0x380,true)).toBe(32);
   view.setUint32(0x48,31,true);mem.fill(0xaa,0x400,0x421);expect((await call('CryptGetHashParam',[hash,2,0x400,0x48,0])).value).toBe(0);expect(lastError).toBe(234);expect(view.getUint32(0x48,true)).toBe(32);expect(mem[0x400]).toBe(0xaa);
   expect(await call('CryptGetHashParam',[hash,2,0x400,0x48,0])).toEqual({value:1,stackCleanup:20});expect(Array.from(mem.slice(0x400,0x420),n=>n.toString(16).padStart(2,'0')).join('')).toBe(expected);expect(mem[0x420]).toBe(0xaa);
   expect((await call('CryptHashData',[hash,0x300,1,0])).value).toBe(0);expect(lastError).toBe(0x8009000c);
   expect((await call('CryptGetHashParam',[hash,2,0x400,0x48,0])).value).toBe(1);expect((await call('CryptDestroyHash',[hash])).value).toBe(1);
  }
  expect((await call('CryptReleaseContext',[context,0])).value).toBe(1);expect(objects.size).toBe(0);
 }finally{System.getInstance=oldSystem;Object.assign(Mem,oldMem);}
});
