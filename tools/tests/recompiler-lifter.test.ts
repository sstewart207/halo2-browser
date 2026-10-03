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

it('discards WAT while retaining a valid deferred binary build', () => {
    const builder = new WasmModuleBuilder();
    const signature = builder.addSignature([], []);
    const fn = builder.addFunction('no_wat', signature, false);
    for (let i = 0; i < 1000; i++) fn.nop();
    expect(fn.watLines.length).toBe(0);
    builder.addExport('no_wat', 0, 0);
    const bytes = builder.toBinary();
    expect(WebAssembly.validate(bytes as any)).toBe(true);
});

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

    it('lifts and executes SSE floating point instructions (MOVSS, ADDSS, MULSS, CVTTSS2SI)', () => {
        // Function computing: (2.5 + 1.5) * 3.0 = 12.0, truncated to 12
        const sseFn: CFGFunction = {
            name: 'test_sse_math',
            entry: '0x403000',
            rva: '0x3000',
            size: 40,
            basicBlocks: [
                {
                    start: '0x403000',
                    end: '0x403028',
                    destinations: [],
                    instructions: [
                        // Store 2.5 at [esp+0x10], 1.5 at [esp+0x14], 3.0 at [esp+0x18]
                        // 2.5 = 0x40200000, 1.5 = 0x3fc00000, 3.0 = 0x40400000
                        { addr: '0x403000', len: 7, mnemonic: 'MOV', ops: 'dword ptr [ESP + 0x10], 0x40200000' },
                        { addr: '0x403007', len: 7, mnemonic: 'MOV', ops: 'dword ptr [ESP + 0x14], 0x3fc00000' },
                        { addr: '0x40300e', len: 7, mnemonic: 'MOV', ops: 'dword ptr [ESP + 0x18], 0x40400000' },
                        // MOVSS XMM0, [esp+0x10]
                        { addr: '0x403015', len: 5, mnemonic: 'MOVSS', ops: 'XMM0, float ptr [ESP + 0x10]' },
                        // ADDSS XMM0, [esp+0x14] -> 4.0
                        { addr: '0x40301a', len: 5, mnemonic: 'ADDSS', ops: 'XMM0, float ptr [ESP + 0x14]' },
                        // MULSS XMM0, [esp+0x18] -> 12.0
                        { addr: '0x40301f', len: 5, mnemonic: 'MULSS', ops: 'XMM0, float ptr [ESP + 0x18]' },
                        // CVTTSS2SI EAX, XMM0 -> EAX = 12
                        { addr: '0x403024', len: 4, mnemonic: 'CVTTSS2SI', ops: 'EAX, XMM0' },
                        { addr: '0x403028', len: 1, mnemonic: 'RET', ops: '' }
                    ]
                }
            ]
        };

        const lifter = new Lifter({ memoryPages: 160 });
        lifter.liftFunction(sseFn);
        lifter.moduleBuilder.addExport(sseFn.name, 0, 0);

        const bytes = lifter.moduleBuilder.toBinary();
        const mod = new WebAssembly.Module(bytes);
        const inst = new WebAssembly.Instance(mod);
        const exports = inst.exports as any;

        const result = exports.test_sse_math(0x19ff00, 0, 0);
        expect(result).toBe(12);
    });

    it('lifts and executes x87 FPU instructions (FLD, FMUL, FISTP)', () => {
        // Function computing: (1.5 * 4.0) = 6.0, stored via FISTP to EAX
        const fpuFn: CFGFunction = {
            name: 'test_fpu_math',
            entry: '0x404000',
            rva: '0x4000',
            size: 30,
            basicBlocks: [
                {
                    start: '0x404000',
                    end: '0x40401e',
                    destinations: [],
                    instructions: [
                        { addr: '0x404000', len: 7, mnemonic: 'MOV', ops: 'dword ptr [ESP + 0x10], 0x3fc00000' }, // 1.5
                        { addr: '0x404007', len: 7, mnemonic: 'MOV', ops: 'dword ptr [ESP + 0x14], 0x40800000' }, // 4.0
                        { addr: '0x40400e', len: 4, mnemonic: 'FLD', ops: 'float ptr [ESP + 0x10]' },
                        { addr: '0x404012', len: 4, mnemonic: 'FMUL', ops: 'float ptr [ESP + 0x14]' },
                        { addr: '0x404016', len: 4, mnemonic: 'FISTP', ops: 'dword ptr [ESP + 0x18]' },
                        { addr: '0x40401a', len: 4, mnemonic: 'MOV', ops: 'EAX, dword ptr [ESP + 0x18]' },
                        { addr: '0x40401e', len: 1, mnemonic: 'RET', ops: '' }
                    ]
                }
            ]
        };

        const lifter = new Lifter({ memoryPages: 160 });
        lifter.liftFunction(fpuFn);
        lifter.moduleBuilder.addExport(fpuFn.name, 0, 0);

        const bytes = lifter.moduleBuilder.toBinary();
        const mod = new WebAssembly.Module(bytes);
        const inst = new WebAssembly.Instance(mod);
        const exports = inst.exports as any;

        const result = exports.test_fpu_math(0x19ff00, 0, 0);
        expect(result).toBe(6);
    });

    it('links and executes direct inter-function calls with stack arguments and forward references', () => {
        // Callee: computes (arg1 + arg2) where arg1 is at [ESP+4], arg2 is at [ESP+8]
        const calleeFn: CFGFunction = {
            name: 'fn_callee_add',
            entry: '0x405000',
            rva: '0x5000',
            size: 9,
            basicBlocks: [
                {
                    start: '0x405000',
                    end: '0x405008',
                    destinations: [],
                    instructions: [
                        { addr: '0x405000', len: 4, mnemonic: 'MOV', ops: 'EAX, dword ptr [ESP + 0x4]' },
                        { addr: '0x405004', len: 4, mnemonic: 'ADD', ops: 'EAX, dword ptr [ESP + 0x8]' },
                        { addr: '0x405008', len: 1, mnemonic: 'RET', ops: '' }
                    ]
                }
            ]
        };

        // Caller: pushes 35 (0x23), pushes 15 (0x0f), calls callee (0x405000), adds 50 (0x32) to result
        // Total expected: 15 + 35 + 50 = 100
        const callerFn: CFGFunction = {
            name: 'fn_caller_math',
            entry: '0x405100',
            rva: '0x5100',
            size: 24,
            basicBlocks: [
                {
                    start: '0x405100',
                    end: '0x405117',
                    destinations: [],
                    instructions: [
                        { addr: '0x405100', len: 5, mnemonic: 'PUSH', ops: '0x23' },
                        { addr: '0x405105', len: 5, mnemonic: 'PUSH', ops: '0xf' },
                        { addr: '0x40510a', len: 5, mnemonic: 'CALL', ops: '0x405000' },
                        { addr: '0x40510f', len: 3, mnemonic: 'ADD', ops: 'ESP, 0x8' },
                        { addr: '0x405112', len: 5, mnemonic: 'ADD', ops: 'EAX, 0x32' },
                        { addr: '0x405117', len: 1, mnemonic: 'RET', ops: '' }
                    ]
                }
            ]
        };

        // Pass caller BEFORE callee in module to verify forward reference resolution
        const cfgExport: CFGExport = {
            program: 'test_call',
            imageBase: '0x400000',
            functions: [callerFn, calleeFn]
        };

        const { wasmBytes } = liftExportedModule(cfgExport, { memoryPages: 160 });
        const mod = new WebAssembly.Module(wasmBytes);
        const inst = new WebAssembly.Instance(mod);
        const exports = inst.exports as any;

        const result = exports.fn_caller_math(0x19ff00, 0, 0);
        expect(result).toBe(100);
    });

    it('parses extended double ptr and handles MOVD float/int register conversion', () => {
        const op = parseOperand('extended double ptr [ESP + 0x8]');
        expect(op).toEqual({
            kind: 'mem',
            size: 8,
            segment: undefined,
            base: 'ESP',
            index: undefined,
            scale: undefined,
            disp: 8
        });

        // Test MOVD: MOV EAX, 0x3f800000 (float 1.0f); MOVD MM0, EAX; MOVD EDX, MM0; MOV EAX, EDX; RET
        const movdFn: CFGFunction = {
            name: 'test_movd',
            entry: '0x406000',
            rva: '0x6000',
            size: 20,
            basicBlocks: [
                {
                    start: '0x406000',
                    end: '0x406014',
                    destinations: [],
                    instructions: [
                        { addr: '0x406000', len: 5, mnemonic: 'MOV', ops: 'EAX, 0x3f800000' },
                        { addr: '0x406005', len: 4, mnemonic: 'MOVD', ops: 'MM0, EAX' },
                        { addr: '0x406009', len: 4, mnemonic: 'MOVD', ops: 'EDX, MM0' },
                        { addr: '0x40600d', len: 2, mnemonic: 'MOV', ops: 'EAX, EDX' },
                        { addr: '0x40600f', len: 1, mnemonic: 'RET', ops: '' }
                    ]
                }
            ]
        };

        const lifter = new Lifter({ memoryPages: 160 });
        lifter.liftFunction(movdFn);
        lifter.moduleBuilder.addExport(movdFn.name, 0, 0);

        const bytes = lifter.moduleBuilder.toBinary();
        const mod = new WebAssembly.Module(bytes);
        const inst = new WebAssembly.Instance(mod);
        const exports = inst.exports as any;

        const result = exports.test_movd(0x19ff00, 0, 0);
        expect(result).toBe(0x3f800000);
    });

    it('translates FS segment memory operations to TEB address', () => {
        const op1 = parseOperand('FS:[0x0]');
        expect(op1.segment).toBe('FS');
        expect(op1.disp).toBe(0);

        const op2 = parseOperand('dword ptr FS:[0x18]');
        expect(op2.segment).toBe('FS');
        expect(op2.disp).toBe(0x18);

        // Test function: reads Self pointer from FS:[0x18], pushes it, reads FS:[0], writes to FS:[0], returns old FS:[0]
        const fsFn: CFGFunction = {
            name: 'test_teb_fs',
            entry: '0x407000',
            rva: '0x7000',
            size: 25,
            basicBlocks: [
                {
                    start: '0x407000',
                    end: '0x407019',
                    destinations: [],
                    instructions: [
                        { addr: '0x407000', len: 6, mnemonic: 'MOV', ops: 'EAX, dword ptr FS:[0x18]' }, // TEB Self
                        { addr: '0x407006', len: 6, mnemonic: 'MOV', ops: 'ECX, FS:[0x0]' },          // Old ExceptionList
                        { addr: '0x40700c', len: 6, mnemonic: 'MOV', ops: 'dword ptr FS:[0x0], EAX' }, // Write Self to ExceptionList
                        { addr: '0x407012', len: 2, mnemonic: 'MOV', ops: 'EAX, ECX' },                // Return old ExceptionList
                        { addr: '0x407014', len: 1, mnemonic: 'RET', ops: '' }
                    ]
                }
            ]
        };

        const tebBase = 0x00030000;
        const lifter = new Lifter({ memoryPages: 160, exportMemory: true, tebAddress: tebBase });
        lifter.liftFunction(fsFn);
        lifter.moduleBuilder.addExport(fsFn.name, 0, 0);

        const bytes = lifter.moduleBuilder.toBinary();
        const mod = new WebAssembly.Module(bytes);
        const inst = new WebAssembly.Instance(mod);
        const exports = inst.exports as any;

        // Initialize TEB in exported memory
        const mem = exports.memory as WebAssembly.Memory;
        const view = new DataView(mem.buffer);
        view.setUint32(tebBase, 0xffffffff, true);     // Initial ExceptionList = -1
        view.setUint32(tebBase + 0x18, tebBase, true); // Self pointer

        const oldExceptionList = exports.test_teb_fs(0x19ff00, 0, 0);
        expect(oldExceptionList).toBe(-1); // 0xffffffff
        // Verify that FS:[0] was updated to tebBase
        expect(view.getUint32(tebBase, true)).toBe(tebBase);
    });

    it('links and executes indirect function calls via registers and runtime bridge', () => {
        // Callee at 0x408000: multiplies argument by 2
        const calleeFn: CFGFunction = {
            name: 'fn_indirect_callee',
            entry: '0x408000',
            rva: '0x8000',
            size: 10,
            basicBlocks: [
                {
                    start: '0x408000',
                    end: '0x408007',
                    destinations: [],
                    instructions: [
                        { addr: '0x408000', len: 4, mnemonic: 'MOV', ops: 'EAX, dword ptr [ESP + 0x4]' },
                        { addr: '0x408004', len: 3, mnemonic: 'ADD', ops: 'EAX, EAX' },
                        { addr: '0x408007', len: 1, mnemonic: 'RET', ops: '' }
                    ]
                }
            ]
        };

        // Caller at 0x408100: pushes 21, moves 0x408000 into EDX, calls EDX
        const callerFn: CFGFunction = {
            name: 'fn_indirect_caller',
            entry: '0x408100',
            rva: '0x8100',
            size: 16,
            basicBlocks: [
                {
                    start: '0x408100',
                    end: '0x40810f',
                    destinations: [],
                    instructions: [
                        { addr: '0x408100', len: 5, mnemonic: 'PUSH', ops: '0x15' },
                        { addr: '0x408105', len: 5, mnemonic: 'MOV', ops: 'EDX, 0x408000' },
                        { addr: '0x40810a', len: 2, mnemonic: 'CALL', ops: 'EDX' },
                        { addr: '0x40810c', len: 3, mnemonic: 'ADD', ops: 'ESP, 0x4' },
                        { addr: '0x40810f', len: 1, mnemonic: 'RET', ops: '' }
                    ]
                }
            ]
        };

        const cfgExport: CFGExport = {
            program: 'test_indirect',
            imageBase: '0x400000',
            functions: [calleeFn, callerFn]
        };

        const { wasmBytes } = liftExportedModule(cfgExport, { memoryPages: 160, exportMemory: true });
        const mod = new WebAssembly.Module(wasmBytes);

        // Create runtime bridge with shared memory
        const memory = new WebAssembly.Memory({ initial: 160 });
        const { RuntimeBridge } = require('../recompiler/runtime-bridge');
        const bridge = new RuntimeBridge({ memory });

        const inst = new WebAssembly.Instance(mod, bridge.createWasmImports());
        bridge.registerExports(inst.exports, [calleeFn, callerFn]);

        const exports = inst.exports as any;
        const result = exports.fn_indirect_caller(0x19ff00, 0, 0);
        expect(result).toBe(42);
    });
});


