import { describe, it, expect } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';
import {
    IATResolver,
    RuntimeBridge,
    Lifter,
    CFGFunction
} from '../recompiler';

describe('Stage 3: IAT Resolver & Runtime Bridge', () => {
    const halo2ExePath = path.resolve(__dirname, '../../../halo2-browser/scratch/ghidra/halo2.exe');

    it('parses PE Import Address Table from halo2.exe', () => {
        if (!fs.existsSync(halo2ExePath)) {
            console.log('Skipping: halo2.exe not found at', halo2ExePath);
            return;
        }

        const resolver = new IATResolver();
        resolver.loadFromFile(halo2ExePath);

        expect(resolver.size()).toBeGreaterThan(400);

        // Verify known IAT entries in halo2.exe
        const getCursor = resolver.resolve(0x79b458);
        expect(getCursor).toBeDefined();
        expect(getCursor?.dll).toBe('user32');
        expect(getCursor?.func).toBe('GetCursor');

        const setCursor = resolver.resolve(0x79b454);
        expect(setCursor).toBeDefined();
        expect(setCursor?.dll).toBe('user32');
        expect(setCursor?.func).toBe('SetCursor');

        const findRes = resolver.resolve(0x79b21c);
        expect(findRes).toBeDefined();
        expect(findRes?.dll).toBe('kernel32');
        expect(findRes?.func).toBe('FindResourceA');
    });

    it('lifts and links a function calling an imported Win32 API', () => {
        // Setup shared memory (32 pages = 2MB covers stack at 0x19ff00)
        const memory = new WebAssembly.Memory({ initial: 32 });

        // Setup IAT resolver with synthetic entries
        const resolver = new IATResolver();
        const dummyExeBuf = Buffer.alloc(1024);
        // We can manually add an entry to the resolver for testing:
        (resolver as any).addressToEntry.set(0x79b458, {
            dll: 'user32',
            func: 'GetCursor',
            iatAddress: 0x79b458
        });

        // Setup runtime bridge
        const bridge = new RuntimeBridge({ memory, iatResolver: resolver });
        let called = false;
        bridge.registerModule('user32', {
            GetCursor: (ctx, mem, args) => {
                called = true;
                return 0x778899aa;
            }
        });
        bridge.bindApi('user32', 'GetCursor', 0);

        // Function that calls [0x79b458] and returns
        const testFunc: CFGFunction = {
            name: 'test_api_call',
            entry: '0x1000',
            rva: '0x1000',
            size: 7,
            basicBlocks: [
                {
                    start: '0x1000',
                    end: '0x1006',
                    instructions: [
                        { addr: '0x1000', len: 6, mnemonic: 'CALL', ops: 'dword ptr [0x0079b458]' },
                        { addr: '0x1006', len: 1, mnemonic: 'RET', ops: '' }
                    ],
                    destinations: []
                }
            ]
        };

        const lifter = new Lifter({ importMemory: true, iatResolver: resolver });
        lifter.liftFunction(testFunc);
        lifter.moduleBuilder.addExport('test_api_call', 0, 0);

        const wasmBytes = lifter.moduleBuilder.toBinary();
        const mod = new WebAssembly.Module(wasmBytes);
        const imports = bridge.createWasmImports();
        const instance = new WebAssembly.Instance(mod, imports);
        const exports = instance.exports as any;

        const ret = exports.test_api_call(0x19ff00, 0, 0);
        expect(called).toBe(true);
        expect(ret).toBe(0x778899aa | 0);
    });

    it('passes stdcall arguments from linear stack memory to HLE handler', () => {
        const memory = new WebAssembly.Memory({ initial: 32 });
        const resolver = new IATResolver();
        (resolver as any).addressToEntry.set(0x79b100, {
            dll: 'kernel32',
            func: 'HeapAlloc',
            iatAddress: 0x79b100
        });

        const bridge = new RuntimeBridge({ memory, iatResolver: resolver });
        let receivedArgs: number[] = [];
        bridge.registerModule('kernel32', {
            HeapAlloc: (ctx, mem, args) => {
                receivedArgs = args;
                return 0x20004000;
            }
        });
        bridge.bindApi('kernel32', 'HeapAlloc', 3);

        // Function that sets up stack and calls HeapAlloc(hHeap=0x1111, flags=0x8, bytes=0x40):
        //   PUSH 0x40
        //   PUSH 0x8
        //   PUSH 0x1111
        //   CALL [0x79b100]
        //   RET
        const testFunc: CFGFunction = {
            name: 'test_heap_alloc_call',
            entry: '0x2000',
            rva: '0x2000',
            size: 15,
            basicBlocks: [
                {
                    start: '0x2000',
                    end: '0x200e',
                    instructions: [
                        { addr: '0x2000', len: 2, mnemonic: 'PUSH', ops: '0x40' },
                        { addr: '0x2002', len: 2, mnemonic: 'PUSH', ops: '0x8' },
                        { addr: '0x2004', len: 5, mnemonic: 'PUSH', ops: '0x1111' },
                        { addr: '0x2009', len: 6, mnemonic: 'CALL', ops: 'dword ptr [0x0079b100]' },
                        { addr: '0x200f', len: 1, mnemonic: 'RET', ops: '' }
                    ],
                    destinations: []
                }
            ]
        };

        const lifter = new Lifter({ importMemory: true, iatResolver: resolver });
        lifter.liftFunction(testFunc);
        lifter.moduleBuilder.addExport('test_heap_alloc_call', 0, 0);

        const wasmBytes = lifter.moduleBuilder.toBinary();
        const mod = new WebAssembly.Module(wasmBytes);
        const imports = bridge.createWasmImports();
        const instance = new WebAssembly.Instance(mod, imports);
        const exports = instance.exports as any;

        const ret = exports.test_heap_alloc_call(0x19ff00, 0, 0);
        expect(ret).toBe(0x20004000);
        expect(receivedArgs.length).toBe(3);
        expect(receivedArgs[0]).toBe(0x1111); // first arg [esp+4]
        expect(receivedArgs[1]).toBe(0x8);    // second arg [esp+8]
        expect(receivedArgs[2]).toBe(0x40);   // third arg [esp+12]
    });
});
