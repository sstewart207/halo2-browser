/**
 * lifter.ts — Translates x86 functions and basic blocks from Ghidra CFG export into WebAssembly.
 */

import {
    CFGBasicBlock,
    CFGFunction,
    CFGExport,
    MemoryOperand,
    Operand,
    ParsedInstruction,
    RegisterOperand,
    LiftedModuleOptions,
    BaseRegisterName
} from './types';
import { parseInstruction } from './parser';
import { WasmFunctionBuilder, WasmModuleBuilder } from './wasm-builder';

// Local indices inside lifted WASM function
export const LOCALS = {
    ESP: 0, // param 0
    ECX: 1, // param 1
    EAX: 2, // param 2
    EDX: 3,
    EBX: 4,
    EBP: 5,
    ESI: 6,
    EDI: 7,
    ZF: 8,
    SF: 9,
    CF: 10,
    OF: 11,
    TMP0: 12,
    TMP1: 13,
    BLOCK_ID: 14,
} as const;

export const REG_TO_LOCAL: Record<BaseRegisterName, number> = {
    ESP: LOCALS.ESP,
    ECX: LOCALS.ECX,
    EAX: LOCALS.EAX,
    EDX: LOCALS.EDX,
    EBX: LOCALS.EBX,
    EBP: LOCALS.EBP,
    ESI: LOCALS.ESI,
    EDI: LOCALS.EDI,
};

export class Lifter {
    moduleBuilder: WasmModuleBuilder;
    options: LiftedModuleOptions;
    funcSigIndex: number;

    constructor(options: LiftedModuleOptions = {}) {
        this.options = {
            memoryPages: 16,
            exportMemory: true,
            importMemory: false,
            ...options
        };
        this.moduleBuilder = new WasmModuleBuilder();
        this.moduleBuilder.memoryPages = this.options.memoryPages!;
        this.moduleBuilder.importMemory = !!this.options.importMemory;
        this.moduleBuilder.exportMemory = !!this.options.exportMemory;

        // Standard signature: (param $esp i32, $ecx i32, $eax i32) -> (result i32)
        this.funcSigIndex = this.moduleBuilder.addSignature([0x7f, 0x7f, 0x7f], [0x7f]);
    }

    liftFunction(fn: CFGFunction): WasmFunctionBuilder {
        const wasmFn = this.moduleBuilder.addFunction(fn.name, this.funcSigIndex);

        // Locals: EDX, EBX, EBP, ESI, EDI, ZF, SF, CF, OF, TMP0, TMP1, BLOCK_ID (12 additional i32 locals)
        wasmFn.addLocals(12, 0x7f);

        // Initialize ESP if 0
        wasmFn.local_get(LOCALS.ESP, 'esp');
        wasmFn.i32_eqz();
        wasmFn.if_block(0x40);
        wasmFn.i32_const(0x19ff00, 'default stack top 1.6MB');
        wasmFn.local_set(LOCALS.ESP, 'esp');
        wasmFn.end();

        if (fn.basicBlocks.length <= 1) {
            // Straight-line single block
            const block = fn.basicBlocks[0];
            if (block) {
                this.liftBasicBlockInstructions(wasmFn, block);
            }
            // Return EAX
            wasmFn.local_get(LOCALS.EAX, 'eax');
            wasmFn.return_op();
            return wasmFn;
        }

        // Multi-block function: dispatch loop
        const numBlocks = fn.basicBlocks.length;
        const blockMap = new Map<number, number>(); // start address -> block index (0..N-1)
        for (let i = 0; i < numBlocks; i++) {
            const startAddr = parseInt(fn.basicBlocks[i].start, 16);
            blockMap.set(startAddr, i);
        }

        // Initialize block_id to 0
        wasmFn.i32_const(0);
        wasmFn.local_set(LOCALS.BLOCK_ID, 'block_id');

        // Outer dispatch loop
        wasmFn.loop(0x40, '$dispatch');

        // Nest blocks b0 to b(N-1)
        // Order: block 0 (outermost, depth N-1), block 1 ... block N-1 (innermost, depth 0)
        for (let i = 0; i < numBlocks; i++) {
            wasmFn.block(0x40, `$b${i}`);
        }

        // Innermost: br_table
        wasmFn.local_get(LOCALS.BLOCK_ID);
        // Table label depths: block i is at depth (numBlocks - 1 - i)
        const labelDepths: number[] = [];
        for (let i = 0; i < numBlocks; i++) {
            labelDepths.push(numBlocks - 1 - i);
        }
        wasmFn.br_table(labelDepths, labelDepths[0]);

        // Now emit blocks from innermost (N-1) to outermost (0)
        for (let i = numBlocks - 1; i >= 0; i--) {
            wasmFn.end(`$b${i}_target`);
            wasmFn.comment(`--- BasicBlock ${i}: ${fn.basicBlocks[i].start} ---`);
            this.liftBasicBlock(wasmFn, fn.basicBlocks[i], i, numBlocks, blockMap);
        }

        wasmFn.end('$dispatch_loop_end');

        // Fallback return EAX
        wasmFn.local_get(LOCALS.EAX, 'eax');
        wasmFn.return_op();

        return wasmFn;
    }

    liftBasicBlockInstructions(fn: WasmFunctionBuilder, block: CFGBasicBlock) {
        for (const rawInst of block.instructions) {
            const inst = parseInstruction(rawInst);
            this.liftInstruction(fn, inst);
        }
    }

    liftBasicBlock(
        fn: WasmFunctionBuilder,
        block: CFGBasicBlock,
        blockIdx: number,
        numBlocks: number,
        blockMap: Map<number, number>
    ) {
        const insts = block.instructions.map(parseInstruction);
        const lastInst = insts.length > 0 ? insts[insts.length - 1] : null;

        // Check if last instruction is a branch or return
        const isBranch = lastInst && (
            lastInst.mnemonic.startsWith('J') ||
            lastInst.mnemonic === 'RET' ||
            lastInst.mnemonic === 'JMP'
        );

        const regularInsts = isBranch ? insts.slice(0, -1) : insts;
        for (const inst of regularInsts) {
            this.liftInstruction(fn, inst);
        }

        if (!lastInst) {
            // Empty block fallthrough to next
            const nextIdx = (blockIdx + 1) % numBlocks;
            fn.i32_const(nextIdx);
            fn.local_set(LOCALS.BLOCK_ID);
            fn.br(blockIdx); // loop back
            return;
        }

        // Loop depth back to $dispatch from block i is blockIdx
        const loopDepth = blockIdx;

        if (lastInst.mnemonic === 'RET') {
            if (lastInst.operands.length > 0 && lastInst.operands[0].kind === 'imm') {
                const imm = lastInst.operands[0].value;
                if (imm > 0) {
                    fn.local_get(LOCALS.ESP);
                    fn.i32_const(imm);
                    fn.i32_add();
                    fn.local_set(LOCALS.ESP);
                }
            }
            fn.local_get(LOCALS.EAX);
            fn.return_op();
            return;
        }

        if (lastInst.mnemonic === 'JMP') {
            const targetAddr = lastInst.operands[0].kind === 'imm' ? lastInst.operands[0].value : 0;
            const targetIdx = blockMap.get(targetAddr) ?? ((blockIdx + 1) % numBlocks);
            fn.i32_const(targetIdx);
            fn.local_set(LOCALS.BLOCK_ID);
            fn.br(loopDepth);
            return;
        }

        if (lastInst.mnemonic.startsWith('J')) {
            // Conditional jump
            const targetAddr = lastInst.operands[0].kind === 'imm' ? lastInst.operands[0].value : 0;
            const targetIdx = blockMap.get(targetAddr) ?? ((blockIdx + 1) % numBlocks);

            // Determine fallthrough block
            let fallthroughIdx = (blockIdx + 1) % numBlocks;
            for (const dst of block.destinations) {
                const dstAddr = parseInt(dst.addr, 16);
                if (dst.type === 'FALL_THROUGH' && blockMap.has(dstAddr)) {
                    fallthroughIdx = blockMap.get(dstAddr)!;
                    break;
                }
            }

            // Emit condition check onto stack
            this.emitJumpCondition(fn, lastInst.mnemonic);

            fn.if_block(0x40);
            fn.i32_const(targetIdx);
            fn.local_set(LOCALS.BLOCK_ID);
            fn.else_block();
            fn.i32_const(fallthroughIdx);
            fn.local_set(LOCALS.BLOCK_ID);
            fn.end();

            fn.br(loopDepth);
            return;
        }

        // Otherwise execute last inst and fall through
        this.liftInstruction(fn, lastInst);
        const nextIdx = (blockIdx + 1) % numBlocks;
        fn.i32_const(nextIdx);
        fn.local_set(LOCALS.BLOCK_ID);
        fn.br(loopDepth);
    }

    emitJumpCondition(fn: WasmFunctionBuilder, mnemonic: string) {
        switch (mnemonic) {
            case 'JZ':
            case 'JE':
                fn.local_get(LOCALS.ZF);
                break;
            case 'JNZ':
            case 'JNE':
                fn.local_get(LOCALS.ZF);
                fn.i32_eqz();
                break;
            case 'JS':
                fn.local_get(LOCALS.SF);
                break;
            case 'JNS':
                fn.local_get(LOCALS.SF);
                fn.i32_eqz();
                break;
            case 'JC':
            case 'JB':
            case 'JNAE':
                fn.local_get(LOCALS.CF);
                break;
            case 'JNC':
            case 'JAE':
            case 'JNB':
                fn.local_get(LOCALS.CF);
                fn.i32_eqz();
                break;
            case 'JA':
            case 'JNBE':
                // CF == 0 and ZF == 0
                fn.local_get(LOCALS.CF);
                fn.i32_eqz();
                fn.local_get(LOCALS.ZF);
                fn.i32_eqz();
                fn.i32_and();
                break;
            case 'JBE':
            case 'JNA':
                // CF != 0 or ZF != 0
                fn.local_get(LOCALS.CF);
                fn.local_get(LOCALS.ZF);
                fn.i32_or();
                break;
            case 'JL':
            case 'JNGE':
                // SF != OF
                fn.local_get(LOCALS.SF);
                fn.local_get(LOCALS.OF);
                fn.i32_ne();
                break;
            case 'JGE':
            case 'JNL':
                // SF == OF
                fn.local_get(LOCALS.SF);
                fn.local_get(LOCALS.OF);
                fn.i32_eq();
                break;
            case 'JLE':
            case 'JNG':
                // ZF != 0 or SF != OF
                fn.local_get(LOCALS.ZF);
                fn.local_get(LOCALS.SF);
                fn.local_get(LOCALS.OF);
                fn.i32_ne();
                fn.i32_or();
                break;
            case 'JG':
            case 'JNLE':
                // ZF == 0 and SF == OF
                fn.local_get(LOCALS.ZF);
                fn.i32_eqz();
                fn.local_get(LOCALS.SF);
                fn.local_get(LOCALS.OF);
                fn.i32_eq();
                fn.i32_and();
                break;
            default:
                // Default: true (always jump)
                fn.i32_const(1);
                break;
        }
    }

    liftInstruction(fn: WasmFunctionBuilder, inst: ParsedInstruction) {
        fn.comment(`0x${inst.addr.toString(16)}: ${inst.mnemonic} ${inst.rawOps}`);

        switch (inst.mnemonic) {
            case 'MOV': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                this.emitLoadOperandValue(fn, src);
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'MOVZX': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                this.emitLoadOperandValue(fn, src); // loads unsigned
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'MOVSX': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                if (src.kind === 'mem') {
                    this.emitEffectiveAddress(fn, src);
                    if (src.size === 1) fn.i32_load8_s(0, 0);
                    else if (src.size === 2) fn.i32_load16_s(0, 1);
                    else fn.i32_load(0, 2);
                } else {
                    this.emitLoadOperandValue(fn, src);
                    if (src.kind === 'reg' && src.size === 1) {
                        fn.i32_const(24); fn.i32_shl(); fn.i32_const(24); fn.i32_shr_s();
                    } else if (src.kind === 'reg' && src.size === 2) {
                        fn.i32_const(16); fn.i32_shl(); fn.i32_const(16); fn.i32_shr_s();
                    }
                }
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'LEA': {
                const [dst, src] = inst.operands;
                if (!dst || src?.kind !== 'mem') return;
                this.emitEffectiveAddress(fn, src);
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'PUSH': {
                const [src] = inst.operands;
                if (!src) return;
                // esp = esp - 4
                fn.local_get(LOCALS.ESP);
                fn.i32_const(4);
                fn.i32_sub();
                fn.local_set(LOCALS.ESP);
                // mem[esp] = src
                fn.local_get(LOCALS.ESP);
                this.emitLoadOperandValue(fn, src);
                fn.i32_store(0, 2);
                break;
            }
            case 'POP': {
                const [dst] = inst.operands;
                if (!dst) return;
                // val = mem[esp]
                fn.local_get(LOCALS.ESP);
                fn.i32_load(0, 2);
                // esp = esp + 4
                fn.local_get(LOCALS.ESP);
                fn.i32_const(4);
                fn.i32_add();
                fn.local_set(LOCALS.ESP);
                // store to dst
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'ADD': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                this.emitLoadOperandValue(fn, dst);
                this.emitLoadOperandValue(fn, src);
                fn.i32_add();
                fn.local_tee(LOCALS.TMP0); // result
                this.emitSetFlagsArithmetic(fn);
                fn.local_get(LOCALS.TMP0);
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'SUB': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                this.emitLoadOperandValue(fn, dst);
                this.emitLoadOperandValue(fn, src);
                fn.i32_sub();
                fn.local_tee(LOCALS.TMP0); // result
                this.emitSetFlagsArithmetic(fn);
                fn.local_get(LOCALS.TMP0);
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'CMP': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                this.emitLoadOperandValue(fn, dst);
                this.emitLoadOperandValue(fn, src);
                fn.i32_sub();
                fn.local_set(LOCALS.TMP0); // result
                this.emitSetFlagsArithmetic(fn);
                break;
            }
            case 'TEST': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                this.emitLoadOperandValue(fn, dst);
                this.emitLoadOperandValue(fn, src);
                fn.i32_and();
                fn.local_set(LOCALS.TMP0); // result
                this.emitSetFlagsLogic(fn);
                break;
            }
            case 'XOR': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                this.emitLoadOperandValue(fn, dst);
                this.emitLoadOperandValue(fn, src);
                fn.i32_xor();
                fn.local_tee(LOCALS.TMP0);
                this.emitSetFlagsLogic(fn);
                fn.local_get(LOCALS.TMP0);
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'AND': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                this.emitLoadOperandValue(fn, dst);
                this.emitLoadOperandValue(fn, src);
                fn.i32_and();
                fn.local_tee(LOCALS.TMP0);
                this.emitSetFlagsLogic(fn);
                fn.local_get(LOCALS.TMP0);
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'OR': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                this.emitLoadOperandValue(fn, dst);
                this.emitLoadOperandValue(fn, src);
                fn.i32_or();
                fn.local_tee(LOCALS.TMP0);
                this.emitSetFlagsLogic(fn);
                fn.local_get(LOCALS.TMP0);
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'INC': {
                const [dst] = inst.operands;
                if (!dst) return;
                this.emitLoadOperandValue(fn, dst);
                fn.i32_const(1);
                fn.i32_add();
                fn.local_tee(LOCALS.TMP0);
                // ZF and SF
                fn.local_get(LOCALS.TMP0); fn.i32_eqz(); fn.local_set(LOCALS.ZF);
                fn.local_get(LOCALS.TMP0); fn.i32_const(0); fn.i32_lt_s(); fn.local_set(LOCALS.SF);
                fn.local_get(LOCALS.TMP0);
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'DEC': {
                const [dst] = inst.operands;
                if (!dst) return;
                this.emitLoadOperandValue(fn, dst);
                fn.i32_const(1);
                fn.i32_sub();
                fn.local_tee(LOCALS.TMP0);
                // ZF and SF
                fn.local_get(LOCALS.TMP0); fn.i32_eqz(); fn.local_set(LOCALS.ZF);
                fn.local_get(LOCALS.TMP0); fn.i32_const(0); fn.i32_lt_s(); fn.local_set(LOCALS.SF);
                fn.local_get(LOCALS.TMP0);
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'SHL': {
                const [dst, count] = inst.operands;
                if (!dst || !count) return;
                this.emitLoadOperandValue(fn, dst);
                this.emitLoadOperandValue(fn, count);
                fn.i32_shl();
                fn.local_tee(LOCALS.TMP0);
                this.emitSetFlagsLogic(fn);
                fn.local_get(LOCALS.TMP0);
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'SHR': {
                const [dst, count] = inst.operands;
                if (!dst || !count) return;
                this.emitLoadOperandValue(fn, dst);
                this.emitLoadOperandValue(fn, count);
                fn.i32_shr_u();
                fn.local_tee(LOCALS.TMP0);
                this.emitSetFlagsLogic(fn);
                fn.local_get(LOCALS.TMP0);
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'SAR': {
                const [dst, count] = inst.operands;
                if (!dst || !count) return;
                this.emitLoadOperandValue(fn, dst);
                this.emitLoadOperandValue(fn, count);
                fn.i32_shr_s();
                fn.local_tee(LOCALS.TMP0);
                this.emitSetFlagsLogic(fn);
                fn.local_get(LOCALS.TMP0);
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'IMUL': {
                if (inst.operands.length === 2) {
                    const [dst, src] = inst.operands;
                    this.emitLoadOperandValue(fn, dst);
                    this.emitLoadOperandValue(fn, src);
                    fn.i32_mul();
                    this.emitStoreOperandValue(fn, dst);
                } else if (inst.operands.length === 3) {
                    const [dst, src1, src2] = inst.operands;
                    this.emitLoadOperandValue(fn, src1);
                    this.emitLoadOperandValue(fn, src2);
                    fn.i32_mul();
                    this.emitStoreOperandValue(fn, dst);
                }
                break;
            }
            case 'SETNZ': {
                const [dst] = inst.operands;
                if (!dst) return;
                fn.local_get(LOCALS.ZF);
                fn.i32_eqz(); // 1 if ZF == 0
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'NOP':
                fn.nop();
                break;
            case 'RET': {
                if (inst.operands.length > 0 && inst.operands[0].kind === 'imm') {
                    const imm = inst.operands[0].value;
                    if (imm > 0) {
                        fn.local_get(LOCALS.ESP);
                        fn.i32_const(imm);
                        fn.i32_add();
                        fn.local_set(LOCALS.ESP);
                    }
                }
                fn.local_get(LOCALS.EAX);
                fn.return_op();
                break;
            }
            default:
                fn.comment(`UNHANDLED: ${inst.mnemonic} ${inst.rawOps}`);
                break;
        }
    }

    emitSetFlagsLogic(fn: WasmFunctionBuilder) {
        // ZF = (TMP0 == 0)
        fn.local_get(LOCALS.TMP0);
        fn.i32_eqz();
        fn.local_set(LOCALS.ZF);
        // SF = (TMP0 < 0)
        fn.local_get(LOCALS.TMP0);
        fn.i32_const(0);
        fn.i32_lt_s();
        fn.local_set(LOCALS.SF);
        // CF = 0, OF = 0
        fn.i32_const(0); fn.local_set(LOCALS.CF);
        fn.i32_const(0); fn.local_set(LOCALS.OF);
    }

    emitSetFlagsArithmetic(fn: WasmFunctionBuilder) {
        // ZF = (TMP0 == 0)
        fn.local_get(LOCALS.TMP0);
        fn.i32_eqz();
        fn.local_set(LOCALS.ZF);
        // SF = (TMP0 < 0)
        fn.local_get(LOCALS.TMP0);
        fn.i32_const(0);
        fn.i32_lt_s();
        fn.local_set(LOCALS.SF);
    }

    emitEffectiveAddress(fn: WasmFunctionBuilder, mem: MemoryOperand) {
        if (!mem.base && !mem.index) {
            fn.i32_const(mem.disp, `addr 0x${(mem.disp >>> 0).toString(16)}`);
            return;
        }

        if (mem.base && !mem.index) {
            fn.local_get(REG_TO_LOCAL[mem.base]);
            if (mem.disp !== 0) {
                fn.i32_const(mem.disp);
                fn.i32_add();
            }
            return;
        }

        if (mem.base && mem.index) {
            fn.local_get(REG_TO_LOCAL[mem.base]);
            fn.local_get(REG_TO_LOCAL[mem.index]);
            if (mem.scale && mem.scale > 1) {
                fn.i32_const(mem.scale);
                fn.i32_mul();
            }
            fn.i32_add();
            if (mem.disp !== 0) {
                fn.i32_const(mem.disp);
                fn.i32_add();
            }
            return;
        }

        if (!mem.base && mem.index) {
            fn.local_get(REG_TO_LOCAL[mem.index]);
            if (mem.scale && mem.scale > 1) {
                fn.i32_const(mem.scale);
                fn.i32_mul();
            }
            if (mem.disp !== 0) {
                fn.i32_const(mem.disp);
                fn.i32_add();
            }
            return;
        }
    }

    emitLoadOperandValue(fn: WasmFunctionBuilder, op: Operand) {
        if (op.kind === 'imm') {
            fn.i32_const(op.value);
            return;
        }

        if (op.kind === 'reg') {
            const localIdx = REG_TO_LOCAL[op.baseReg];
            fn.local_get(localIdx, op.name);
            if (op.size === 1) {
                if (op.highByte) {
                    fn.i32_const(8);
                    fn.i32_shr_u();
                }
                fn.i32_const(0xff);
                fn.i32_and();
            } else if (op.size === 2) {
                fn.i32_const(0xffff);
                fn.i32_and();
            }
            return;
        }

        if (op.kind === 'mem') {
            this.emitEffectiveAddress(fn, op);
            if (op.size === 1) {
                fn.i32_load8_u(0, 0);
            } else if (op.size === 2) {
                fn.i32_load16_u(0, 1);
            } else {
                fn.i32_load(0, 2);
            }
            return;
        }
    }

    emitStoreOperandValue(fn: WasmFunctionBuilder, dst: Operand) {
        if (dst.kind === 'reg') {
            const localIdx = REG_TO_LOCAL[dst.baseReg];
            if (dst.size === 4) {
                fn.local_set(localIdx, dst.name);
            } else if (dst.size === 1) {
                // Save value in TMP0
                fn.local_set(LOCALS.TMP0);
                // reg = (reg & mask) | (TMP0 & 0xff)
                fn.local_get(localIdx);
                if (dst.highByte) {
                    fn.i32_const(~0xff00 | 0);
                    fn.i32_and();
                    fn.local_get(LOCALS.TMP0);
                    fn.i32_const(0xff);
                    fn.i32_and();
                    fn.i32_const(8);
                    fn.i32_shl();
                    fn.i32_or();
                } else {
                    fn.i32_const(~0xff | 0);
                    fn.i32_and();
                    fn.local_get(LOCALS.TMP0);
                    fn.i32_const(0xff);
                    fn.i32_and();
                    fn.i32_or();
                }
                fn.local_set(localIdx);
            } else if (dst.size === 2) {
                fn.local_set(LOCALS.TMP0);
                fn.local_get(localIdx);
                fn.i32_const(~0xffff | 0);
                fn.i32_and();
                fn.local_get(LOCALS.TMP0);
                fn.i32_const(0xffff);
                fn.i32_and();
                fn.i32_or();
                fn.local_set(localIdx);
            }
            return;
        }

        if (dst.kind === 'mem') {
            // Value is on stack, save into TMP0
            fn.local_set(LOCALS.TMP0);
            // Calculate address
            this.emitEffectiveAddress(fn, dst);
            // Load value from TMP0
            fn.local_get(LOCALS.TMP0);
            if (dst.size === 1) {
                fn.i32_store8(0, 0);
            } else if (dst.size === 2) {
                fn.i32_store16(0, 1);
            } else {
                fn.i32_store(0, 2);
            }
            return;
        }
    }
}

export function liftExportedModule(cfgExport: CFGExport, options: LiftedModuleOptions = {}): {
    builder: WasmModuleBuilder;
    wasmBytes: Uint8Array;
    watText: string;
} {
    const lifter = new Lifter(options);
    for (let i = 0; i < cfgExport.functions.length; i++) {
        const fn = cfgExport.functions[i];
        lifter.liftFunction(fn);
        lifter.moduleBuilder.addExport(fn.name, 0, i);
    }

    return {
        builder: lifter.moduleBuilder,
        wasmBytes: lifter.moduleBuilder.toBinary(),
        watText: lifter.moduleBuilder.toWat(),
    };
}
