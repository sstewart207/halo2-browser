import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
    parseOperand,
    parseInstruction,
    encodeULEB128,
    encodeSLEB128,
    WasmModuleBuilder,
    Lifter,
    liftExportedModule,
    CFGExport,
    CFGFunction
} from '../recompiler';

describe('Recompiler Operand & Instruction Parser', () => {
    it('parses registers correctly', () => {
        const eax = parseOperand('EAX');
        expect(eax).toEqual({ kind: 'reg', name: 'EAX', baseReg: 'EAX', size: 4, highByte: undefined });

        const al = parseOperand('AL');
        expect(al).toEqual({ kind: 'reg', name: 'AL', baseReg: 'EAX', size: 1, highByte: undefined });

        const ah = parseOperand('AH');
        expect(ah).toEqual({ kind: 'reg', name: 'AH', baseReg: 'EAX', size: 1, highByte: true });

        const cx = parseOperand('CX');
        expect(cx).toEqual({ kind: 'reg', name: 'CX', baseReg: 'ECX', size: 2, highByte: undefined });
    });

    it('parses immediate numbers correctly', () => {
        const hex = parseOperand('0x401000');
        expect(hex).toEqual({ kind: 'imm', value: 0x401000 });

        const neg = parseOperand('-0x4');
        expect(neg).toEqual({ kind: 'imm', value: -4 });

        const dec = parseOperand('42');
        expect(dec).toEqual({ kind: 'imm', value: 42 });
    });

    it('parses memory operands with various addressing modes', () => {
        const direct = parseOperand('[0x0086d894]');
        expect(direct).toEqual({
            kind: 'mem',
            size: 4,
            base: undefined,
            index: undefined,
            scale: undefined,
            disp: 0x86d894
        });

        const stack = parseOperand('dword ptr [ESP + 0x4]');
        expect(stack).toEqual({
            kind: 'mem',
            size: 4,
            base: 'ESP',
            index: undefined,
            scale: undefined,
            disp: 4
        });

        const negOffset = parseOperand('[ESP + -0x4]');
        expect(negOffset).toEqual({
            kind: 'mem',
            size: 4,
            base: 'ESP',
            index: undefined,
            scale: undefined,
            disp: -4
        });

        const indexed = parseOperand('[ECX*0x4 + 0x86d820]');
        expect(indexed).toEqual({
            kind: 'mem',
            size: 4,
            base: undefined,
            index: 'ECX',
            scale: 4,
            disp: 0x86d820
        });

        const complex = parseOperand('[EDX + ECX*0x4 + 0xc]');
        expect(complex).toEqual({
            kind: 'mem',
            size: 4,
            base: 'EDX',
            index: 'ECX',
            scale: 4,
            disp: 12
        });

        const byteMem = parseOperand('byte ptr [EAX]');
        expect(byteMem).toEqual({
            kind: 'mem',
            size: 1,
            base: 'EAX',
            index: undefined,
            scale: undefined,
            disp: 0
        });
    });

    it('parses complete instructions', () => {
        const inst = parseInstruction({
            addr: '0x40147b',
            len: 4,
            mnemonic: 'MOV',
            ops: 'dword ptr [ESP + 0x4], EAX'
        });
        expect(inst.addr).toBe(0x40147b);
        expect(inst.mnemonic).toBe('MOV');
        expect(inst.operands.length).toBe(2);
        expect(inst.operands[0].kind).toBe('mem');
        expect(inst.operands[1].kind).toBe('reg');
    });
});

describe('WebAssembly Builder', () => {
    it('encodes ULEB128 and SLEB128 correctly', () => {
        expect(encodeULEB128(0)).toEqual([0]);
        expect(encodeULEB128(1)).toEqual([1]);
        expect(encodeULEB128(127)).toEqual([127]);
        expect(encodeULEB128(128)).toEqual([0x80, 0x01]);
        expect(encodeULEB128(624485)).toEqual([0xE5, 0x8E, 0x26]);

        expect(encodeSLEB128(0)).toEqual([0]);
        expect(encodeSLEB128(1)).toEqual([1]);
        expect(encodeSLEB128(-1)).toEqual([0x7f]);
        expect(encodeSLEB128(-4)).toEqual([0x7c]);
    });

    it('creates executable WebAssembly modules', () => {
        const builder = new WasmModuleBuilder();
        const sig = builder.addSignature([], [0x7f]);
        const fn = builder.addFunction('test_const', sig);
        fn.i32_const(1337);
        fn.return_op();
        builder.addExport('test_const', 0, 0);

        const bytes = builder.toBinary();
        const mod = new WebAssembly.Module(bytes);
        const inst = new WebAssembly.Instance(mod);
        const exported = inst.exports as any;
        expect(exported.test_const()).toBe(1337);
    });
});

describe('AOT Lifter Execution', () => {
    it('lifts and executes FUN_00401000 (XOR AL, AL; RET)', () => {
        const fnDef: CFGFunction = {
            name: 'FUN_00401000',
            entry: '0x401000',
            rva: '0x1000',
            size: 3,
            basicBlocks: [
                {
                    start: '0x401000',
                    end: '0x401002',
                    instructions: [
                        { addr: '0x401000', len: 2, mnemonic: 'XOR', ops: 'AL, AL' },
                        { addr: '0x401002', len: 1, mnemonic: 'RET', ops: '' }
                    ],
                    destinations: []
                }
            ]
        };

        const lifter = new Lifter();
        lifter.liftFunction(fnDef);
        lifter.moduleBuilder.addExport(fnDef.name, 0, 0);

        const bytes = lifter.moduleBuilder.toBinary();
        const mod = new WebAssembly.Module(bytes);
        const instance = new WebAssembly.Instance(mod);
        const exports = instance.exports as any;

        // Call with initial eax = 0xff
        const result = exports.FUN_00401000(0x19ff00, 0, 0xff);
        // XOR AL, AL clears low byte, leaves upper bits
        expect(result & 0xff).toBe(0);
    });

    it('lifts and executes FUN_00401003 (MOV AL, 0x1; RET)', () => {
        const fnDef: CFGFunction = {
            name: 'FUN_00401003',
            entry: '0x401003',
            rva: '0x1003',
            size: 3,
            basicBlocks: [
                {
                    start: '0x401003',
                    end: '0x401005',
                    instructions: [
                        { addr: '0x401003', len: 2, mnemonic: 'MOV', ops: 'AL, 0x1' },
                        { addr: '0x401005', len: 1, mnemonic: 'RET', ops: '' }
                    ],
                    destinations: []
                }
            ]
        };

        const lifter = new Lifter();
        lifter.liftFunction(fnDef);
        lifter.moduleBuilder.addExport(fnDef.name, 0, 0);

        const bytes = lifter.moduleBuilder.toBinary();
        const mod = new WebAssembly.Module(bytes);
        const instance = new WebAssembly.Instance(mod);
        const exports = instance.exports as any;

        const result = exports.FUN_00401003(0x19ff00, 0, 0);
        expect(result & 0xff).toBe(1);
    });

    it('lifts and executes FUN_00401461 (MOV EAX, 0x2; RET)', () => {
        const fnDef: CFGFunction = {
            name: 'FUN_00401461',
            entry: '0x401461',
            rva: '0x1461',
            size: 6,
            basicBlocks: [
                {
                    start: '0x401461',
                    end: '0x401466',
                    instructions: [
                        { addr: '0x401461', len: 5, mnemonic: 'MOV', ops: 'EAX, 0x2' },
                        { addr: '0x401466', len: 1, mnemonic: 'RET', ops: '' }
                    ],
                    destinations: []
                }
            ]
        };

        const lifter = new Lifter();
        lifter.liftFunction(fnDef);
        lifter.moduleBuilder.addExport(fnDef.name, 0, 0);

        const bytes = lifter.moduleBuilder.toBinary();
        const mod = new WebAssembly.Module(bytes);
        const instance = new WebAssembly.Instance(mod);
        const exports = instance.exports as any;

        const result = exports.FUN_00401461(0, 0, 0);
        expect(result).toBe(2);
    });

    it('lifts and executes memory reads (MOV AL, [0x0086d894]; RET)', () => {
        // We use 32 pages (2MB) for this test to cover 0x86d894 (8.8 MB needs ~142 pages)
        const pagesNeeded = Math.ceil(0x86d894 / 65536) + 2;
        const lifter = new Lifter({ memoryPages: pagesNeeded });

        const fnDef: CFGFunction = {
            name: 'FUN_0040145b',
            entry: '0x40145b',
            rva: '0x145b',
            size: 6,
            basicBlocks: [
                {
                    start: '0x40145b',
                    end: '0x401460',
                    instructions: [
                        { addr: '0x40145b', len: 5, mnemonic: 'MOV', ops: 'AL, [0x0086d894]' },
                        { addr: '0x401460', len: 1, mnemonic: 'RET', ops: '' }
                    ],
                    destinations: []
                }
            ]
        };

        lifter.liftFunction(fnDef);
        lifter.moduleBuilder.addExport(fnDef.name, 0, 0);

        const bytes = lifter.moduleBuilder.toBinary();
        const mod = new WebAssembly.Module(bytes);
        const instance = new WebAssembly.Instance(mod);
        const exports = instance.exports as any;

        // Write test value into memory at 0x0086d894
        const memBuffer = new Uint8Array(exports.memory.buffer);
        memBuffer[0x86d894] = 0x5a;

        const result = exports.FUN_0040145b(0x19ff00, 0, 0);
        expect(result & 0xff).toBe(0x5a);
    });

    it('lifts and executes multi-block loop with branch logic', () => {
        // Function computing sum = 1 + 2 + 3 + 4 + 5 = 15:
        // b0:
        //   MOV EAX, 0
        //   MOV ECX, 5
        // b1:
        //   ADD EAX, ECX
        //   SUB ECX, 1
        //   JNZ 0x1010
        // b2:
        //   RET
        const loopFn: CFGFunction = {
            name: 'test_loop_sum',
            entry: '0x1000',
            rva: '0x1000',
            size: 20,
            basicBlocks: [
                {
                    start: '0x1000',
                    end: '0x1007',
                    instructions: [
                        { addr: '0x1000', len: 5, mnemonic: 'MOV', ops: 'EAX, 0x0' },
                        { addr: '0x1005', len: 5, mnemonic: 'MOV', ops: 'ECX, 0x5' }
                    ],
                    destinations: [
                        { addr: '0x1010', type: 'FALL_THROUGH' }
                    ]
                },
                {
                    start: '0x1010',
                    end: '0x1018',
                    instructions: [
                        { addr: '0x1010', len: 2, mnemonic: 'ADD', ops: 'EAX, ECX' },
                        { addr: '0x1012', len: 3, mnemonic: 'SUB', ops: 'ECX, 0x1' },
                        { addr: '0x1015', len: 2, mnemonic: 'JNZ', ops: '0x1010' }
                    ],
                    destinations: [
                        { addr: '0x1010', type: 'CONDITIONAL_JUMP' },
                        { addr: '0x1020', type: 'FALL_THROUGH' }
                    ]
                },
                {
                    start: '0x1020',
                    end: '0x1021',
                    instructions: [
                        { addr: '0x1020', len: 1, mnemonic: 'RET', ops: '' }
                    ],
                    destinations: []
                }
            ]
        };

        const lifter = new Lifter();
        lifter.liftFunction(loopFn);
        lifter.moduleBuilder.addExport(loopFn.name, 0, 0);

        const bytes = lifter.moduleBuilder.toBinary();
        const mod = new WebAssembly.Module(bytes);
        const instance = new WebAssembly.Instance(mod);
        const exports = instance.exports as any;

        const result = exports.test_loop_sum(0, 0, 0);
        expect(result).toBe(15);
    });

    it('lifts and compiles all functions in cfg_sample.json', () => {
        const samplePath = path.resolve(__dirname, '../../../halo2-browser/scratch/ghidra/cfg_sample.json');
        if (!fs.existsSync(samplePath)) {
            console.log('Skipping sample file test (cfg_sample.json not found)');
            return;
        }

        const rawJson = fs.readFileSync(samplePath, 'utf8');
        const cfgExport: CFGExport = JSON.parse(rawJson);

        const { wasmBytes, watText } = liftExportedModule(cfgExport, { memoryPages: 160 });
        expect(wasmBytes.length).toBeGreaterThan(100);
        expect(watText.length).toBeGreaterThan(100);

        const mod = new WebAssembly.Module(wasmBytes);
        const inst = new WebAssembly.Instance(mod);
        const exports = inst.exports as any;

        // Verify functions exist and are callable
        expect(typeof exports.FUN_00401000).toBe('function');
        expect(typeof exports.FUN_00401003).toBe('function');
        expect(typeof exports.FUN_00401461).toBe('function');

        expect(exports.FUN_00401003(0, 0, 0) & 0xff).toBe(1);
        expect(exports.FUN_00401461(0, 0, 0)).toBe(2);
    });
});
