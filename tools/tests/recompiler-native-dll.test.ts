import {test,expect} from 'bun:test';
import {RuntimeBridge} from '../../src/worker/core/recompiler/runtime-bridge';
import {RecompilerRunner} from '../../src/worker/core/recompiler/recompiler-runner';
import {WasmModuleBuilder} from '../recompiler/wasm-builder';

test('native imports call the actual compiled export and preserve native cleanup',()=>{
 const memory=new WebAssembly.Memory({initial:1});const esp=new WebAssembly.Global({value:'i32',mutable:true},0);
 const bridge=new RuntimeBridge({memory,nativeApiResolver:(dll,func)=>dll==='xlive.dll'&&func==='ord_5000'?0x13001234:undefined});
 bridge.registerModule('xlive.dll',{ord_5000:()=>{throw new Error('must not use HLE');}});
 bridge.registerExports({esp,addr_0x13001234:(stack:number)=>{expect(stack).toBe(0x8000);esp.value=stack+8;return 7;}});
 expect(bridge.callApi('xlive.dll','ord_5000',0x8000)).toBe(7);expect(esp.value).toBe(0x8008);
});

test('missing native export reports the loaded guest address without fake success',()=>{
 const bridge=new RuntimeBridge({memory:new WebAssembly.Memory({initial:1}),nativeApiResolver:()=>0x13001234});
 expect(()=>bridge.callApi('xlive.dll','ord_5000',0x8000)).toThrow('AOT native export not recompiled: xlive.dll!ord_5000@0x13001234');
});

function fixture(attach: number, nativeBase?: number) {
 const b=new WasmModuleBuilder();b.importMemory=true;b.memoryPages=160;const sig=b.addSignature([0x7f,0x7f,0x7f],[0x7f]);
 const count=b.addGlobal(0x7f,1,0);b.addExport('count',3,count);
 const dll=b.addFunction('attach',sig);dll.local_get(0);dll.i32_const(8);dll.i32_add();dll.i32_load();dll.i32_const(1);dll.i32_eq();dll.global_set(count);dll.i32_const(attach);dll.return_op();
 const entry=b.addFunction('entry',sig);entry.global_get(count);entry.return_op();b.addExport('addr_0x5000',0,0);b.addExport('entry',0,1);
 if(nativeBase!==undefined){const g=b.addGlobal(0x7f,0,nativeBase);b.addExport('aot_native_base_test',3,g);}
 const memory=new WebAssembly.Memory({initial:160});const module={initialized:false};
 const system={process:{moduleRegistry:{getMainExecutableBase:()=>0x400000,getByBase:()=>module},dispatcher:null}} as any;
 return {memory,system,module,wasmBytes:b.toBinary(),stackTop:0x8000,dllInits:[{name:'test.dll',baseAddress:0x4000,entryPoint:0x5000}]};
}

test('runner calls DLL_PROCESS_ATTACH before EXE entry and marks it initialized',async()=>{
 const f=fixture(1);expect(await new RecompilerRunner().start(f)).toBe(1);expect(f.module.initialized).toBe(true);
 const v=new DataView(f.memory.buffer);expect(v.getUint32(0x7ff4,true)).toBe(0x4000);expect(v.getUint32(0x7ffc,true)).toBe(1);
});

test('failed DLL attach blocks EXE entry and leaves initialization false',async()=>{
 const f=fixture(0);await expect(new RecompilerRunner().start(f)).rejects.toThrow('AOT DllMain rejected process attach: test.dll');expect(f.module.initialized).toBe(false);
});


test('runner preserves a native ordinal import target instead of an HLE self-thunk',async()=>{
 const f=fixture(1);f.dllInits=[];
 f.system.process.moduleRegistry.getByName=()=>({isRealDll:true});
 f.system.process.moduleRegistry.getExportAddress=(dll:string,func:string)=>{expect(dll).toBe('xlive.dll');expect(func).toBe('ord_5000');return 0x13001234;};
 const v=new DataView(f.memory.buffer);const base=0x400000;v.setUint32(base+128,0x200,true);v.setUint32(base+132,40,true);
 v.setUint32(base+0x200,0x240,true);v.setUint32(base+0x20c,0x280,true);v.setUint32(base+0x210,0x260,true);
 v.setUint32(base+0x240,0x80001388,true);v.setUint32(base+0x260,0x13001234,true);
 new Uint8Array(f.memory.buffer).set(new TextEncoder().encode('xlive.dll\0'),base+0x280);
 await new RecompilerRunner().start(f);expect(v.getUint32(base+0x260,true)).toBe(0x13001234);
});


test('unimplemented compatibility and mutex APIs stop instead of fabricated success',()=>{
 const b=new RuntimeBridge({memory:new WebAssembly.Memory({initial:1})});
 expect(()=>b.callApi('pccompat.dll','AnyExport',0x8000)).toThrow('AOT API implementation missing');
 expect(()=>b.callApi('kernel32.dll','CreateMutexW',0x8000)).toThrow('AOT API implementation missing');
});


test('native build rejects a different loader base before invoking DLL or EXE',async()=>{
 const f=fixture(1,0x6000);f.system.process.moduleRegistry.getByName=()=>({baseAddress:0x4000});
 await expect(new RecompilerRunner().start(f)).rejects.toThrow('AOT native image base mismatch');expect(f.module.initialized).toBe(false);
});

test('DLL import descriptors contribute their CRT DLL names to WASM binding',async()=>{
 const b=new WasmModuleBuilder();b.importMemory=true;b.memoryPages=160;
 const api=b.addSignature([0x7f],[0x7f]);b.addFunctionImport('env','win32_msvcrt___CxxFrameHandler',api);
 const sig=b.addSignature([0x7f,0x7f,0x7f],[0x7f]);const f=b.addFunction('entry',sig);f.i32_const(7);f.return_op();b.addExport('entry',0,0);
 const memory=new WebAssembly.Memory({initial:160});const v=new DataView(memory.buffer),base=0x500000;
 v.setUint32(base+128,0x200,true);v.setUint32(base+132,40,true);v.setUint32(base+0x20c,0x280,true);
 new Uint8Array(memory.buffer).set(new TextEncoder().encode('msvcrt.dll\0'),base+0x280);
 const system={process:{moduleRegistry:{getMainExecutableBase:()=>0x400000,getAllModules:()=>[{isRealDll:true,baseAddress:base}]},dispatcher:null}} as any;
 expect(await new RecompilerRunner().start({system,memory,wasmBytes:b.toBinary(),stackTop:0x8000})).toBe(7);
});


for(const api of ['_initterm','_initterm_e'])test(`${api} invokes compiled initializers without entering the CPU scheduler`,()=>{
 const memory=new WebAssembly.Memory({initial:1}),v=new DataView(memory.buffer),esp=new WebAssembly.Global({value:'i32',mutable:true},0),calls:number[]=[];
 v.setUint32(0x8000,0x1234,true);v.setUint32(0x8004,0x5000,true);v.setUint32(0x8008,0x5010,true);
 [0,0x1000,0x2000,0x3000].forEach((target,i)=>v.setUint32(0x5000+i*4,target,true));
 const b=new RuntimeBridge({memory});b.registerModule('msvcrt',{[api]:()=>{throw new Error('CPU scheduler used');}});
 const callback=(address:number,value:number)=>(stack:number)=>{calls.push(address);expect(stack).toBe(0x7ffc);esp.value=stack+4;return value;};
 b.registerExports({esp,addr_0x1000:callback(0x1000,0),addr_0x2000:callback(0x2000,7),addr_0x3000:callback(0x3000,0)});
 expect(b.callApi('msvcrt.dll',api,0x8000)).toBe(api==='_initterm_e'?7:0);
 expect(calls).toEqual(api==='_initterm_e'?[0x1000,0x2000]:[0x1000,0x2000,0x3000]);expect(esp.value).toBe(0x8004);
});

test('missing compiled initializer is rejected before any constructor is run',()=>{
 const memory=new WebAssembly.Memory({initial:1}),v=new DataView(memory.buffer);let calls=0;
 v.setUint32(0x8004,0x5000,true);v.setUint32(0x8008,0x5008,true);v.setUint32(0x5000,0x1000,true);v.setUint32(0x5004,0x2000,true);
 const b=new RuntimeBridge({memory});b.registerExports({addr_0x1000:()=>{calls++;return 0;}});
 expect(()=>b.callApi('msvcrt','_initterm',0x8000)).toThrow('AOT CRT initializer not recompiled: 0x2000');expect(calls).toBe(0);
});
