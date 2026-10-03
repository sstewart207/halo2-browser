/**
 * lifter.ts — Translates x86 functions and basic blocks from Ghidra CFG export into WebAssembly.
 */

import {
    CFGBasicBlock,
    CFGFunction,
    CFGExport,
    CFGInstruction,
    MemoryOperand,
    Operand,
    ParsedInstruction,
    RegisterOperand,
    LiftedModuleOptions,
    BaseRegisterName
} from './types';
import { parseInstruction } from './parser';
import { WasmFunctionBuilder, WasmModuleBuilder } from './wasm-builder';

import { IATResolver } from './iat-resolver';

// AVX semantics are not implemented. Preserve the instruction address for an
// explicit runtime trap without trying to parse unsupported YMM operands.
function parseForLifting(inst: CFGInstruction): ParsedInstruction {
    if (/^V[A-Z]/.test(inst.mnemonic)) {
        return {addr:parseInt(inst.addr,16),len:inst.len,mnemonic:inst.mnemonic,operands:[],rawOps:inst.ops};
    }
    return parseInstruction(inst);
}

// Local indices inside lifted WASM function
export const LOCALS = {
    ESP: 0, // param 0 (i32)
    ECX: 1, // param 1 (i32)
    EAX: 2, // param 2 (i32)
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
    // SSE registers (f32 locals)
    XMM0: 15,
    XMM1: 16,
    XMM2: 17,
    XMM3: 18,
    XMM4: 19,
    XMM5: 20,
    XMM6: 21,
    XMM7: 22,
    // x87 FPU stack registers (f32 locals)
    ST0: 23,
    ST1: 24,
    ST2: 25,
    ST3: 26,
    ST4: 27,
    ST5: 28,
    ST6: 29,
    ST7: 30,
    F32_TMP: 31,
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
    XMM0: LOCALS.XMM0,
    XMM1: LOCALS.XMM1,
    XMM2: LOCALS.XMM2,
    XMM3: LOCALS.XMM3,
    XMM4: LOCALS.XMM4,
    XMM5: LOCALS.XMM5,
    XMM6: LOCALS.XMM6,
    XMM7: LOCALS.XMM7,
    ST0: LOCALS.ST0,
    ST1: LOCALS.ST1,
    ST2: LOCALS.ST2,
    ST3: LOCALS.ST3,
    ST4: LOCALS.ST4,
    ST5: LOCALS.ST5,
    ST6: LOCALS.ST6,
    ST7: LOCALS.ST7,
    MM0: LOCALS.ST0,
    MM1: LOCALS.ST1,
    MM2: LOCALS.ST2,
    MM3: LOCALS.ST3,
    MM4: LOCALS.ST4,
    MM5: LOCALS.ST5,
    MM6: LOCALS.ST6,
    MM7: LOCALS.ST7,
    ES: LOCALS.TMP0,
    DS: LOCALS.TMP0,
    FS: LOCALS.TMP0,
    GS: LOCALS.TMP0,
    CS: LOCALS.TMP0,
    SS: LOCALS.TMP0,
};

export function isFloatReg(reg: BaseRegisterName): boolean {
    const loc = REG_TO_LOCAL[reg];
    return loc >= LOCALS.XMM0 && loc <= LOCALS.F32_TMP;
}

export class Lifter {
    moduleBuilder: WasmModuleBuilder;
    options: LiftedModuleOptions;
    funcSigIndex: number;
    apiImportSigIndex: number;
    iatResolver?: IATResolver;
    apiImportMap = new Map<string, number>();
    funcEntryMap = new Map<number, number>(); // entryAddr -> local function index (0..N-1)
    espGlobalIdx: number;
    private registerGlobals = new Map<number, number>();
    private xmmLanes: number[][] = [];
    memoryBaseGlobalIdx: number;
    private x87Stack: number[] = [];
    private x87Status: number;
    private x87Control: number;
    private x87Top: number;
    private x87Imports = new Map<string, number>();
    private unsupportedPc: number;
    private eflags: number;
    private mxcsr: number;
    private debugFuel?: number;
    private debugPc?: number;

    constructor(options: LiftedModuleOptions = {}) {
        this.options = {
            memoryPages: 16,
            exportMemory: true,
            importMemory: false,
            ...options
        };
        this.iatResolver = options.iatResolver;
        this.moduleBuilder = new WasmModuleBuilder();
        this.moduleBuilder.memoryPages = this.options.memoryPages!;
        this.moduleBuilder.importMemory = !!this.options.importMemory;
        this.moduleBuilder.exportMemory = !!this.options.exportMemory;

        // Shared mutable stack pointer global (exported as "esp")
        this.espGlobalIdx = this.moduleBuilder.addGlobal(0x7f, 1, 0x0019ff00);
        this.moduleBuilder.addExport('esp', 3, this.espGlobalIdx);
        // Optimized internal x86 calls may use any GPR, not only EAX/ECX.
        for (const name of ['ECX', 'EDX', 'EBX', 'EBP', 'ESI', 'EDI'] as const) {
            const index = this.moduleBuilder.addGlobal(0x7f, 1, 0);
            this.registerGlobals.set(LOCALS[name], index);
            this.moduleBuilder.addExport(name.toLowerCase(), 3, index);
        }
        this.memoryBaseGlobalIdx = this.moduleBuilder.addGlobal(0x7f, 1, 0);
        for (let reg=0;reg<8;reg++) {
            const lanes: number[]=[];
            for(let lane=0;lane<4;lane++) {
                const index=this.moduleBuilder.addGlobal(0x7f,1,0);lanes.push(index);
                this.moduleBuilder.addExport(`xmm${reg}_lane${lane}`,3,index);
            }
            this.xmmLanes.push(lanes);
        }
        this.moduleBuilder.addExport('guest_memory_base', 3, this.memoryBaseGlobalIdx);
        for (let n=0;n<8;n++) {
            const index=this.moduleBuilder.addGlobal(0x7c,1,0);this.x87Stack.push(index);
            this.moduleBuilder.addExport(`x87_st${n}`,3,index);
        }
        this.x87Status=this.moduleBuilder.addGlobal(0x7f,1,0);
        this.x87Control=this.moduleBuilder.addGlobal(0x7f,1,0x37f);
        this.x87Top=this.moduleBuilder.addGlobal(0x7f,1,0);
        this.moduleBuilder.addExport('x87_status',3,this.x87Status);
        this.moduleBuilder.addExport('x87_control',3,this.x87Control);
        this.unsupportedPc=this.moduleBuilder.addGlobal(0x7f,1,0);
        this.moduleBuilder.addExport('aot_unsupported_pc',3,this.unsupportedPc);
        this.eflags = this.moduleBuilder.addGlobal(0x7f, 1, 0x0202);
        this.moduleBuilder.addExport('eflags', 3, this.eflags);
        this.mxcsr = this.moduleBuilder.addGlobal(0x7f, 1, 0x1f80);
        this.moduleBuilder.addExport('mxcsr', 3, this.mxcsr);
        if (options.debugBlockLimit !== undefined) {
            this.debugFuel = this.moduleBuilder.addGlobal(0x7f, 1, options.debugBlockLimit);
            this.debugPc = this.moduleBuilder.addGlobal(0x7f, 1, 0);
            this.moduleBuilder.addExport('aot_debug_fuel', 3, this.debugFuel);
            this.moduleBuilder.addExport('aot_debug_pc', 3, this.debugPc);
        }

        // Standard signature: (param $esp i32, $ecx i32, $eax i32) -> (result i32)
        this.funcSigIndex = this.moduleBuilder.addSignature([0x7f, 0x7f, 0x7f], [0x7f]);
        // Bridge API signature: (param $esp i32) -> (result i32)
        this.apiImportSigIndex = this.moduleBuilder.addSignature([0x7f], [0x7f]);
    }


    getOrAddApiImport(dll: string, func: string): number {
        const key = `${dll.toLowerCase()}_${func}`;
        if (this.apiImportMap.has(key)) {
            return this.apiImportMap.get(key)!;
        }
        const importName = `win32_${key}`;
        const idx = this.moduleBuilder.addFunctionImport('env', importName, this.apiImportSigIndex, importName);
        this.apiImportMap.set(key, idx);
        return idx;
    }

    indirectCallSigIndex?: number;
    indirectCallImportIdx?: number;

    getOrAddIndirectCallImport(): number {
        if (this.indirectCallImportIdx !== undefined) {
            return this.indirectCallImportIdx;
        }
        if (this.indirectCallSigIndex === undefined) {
            this.indirectCallSigIndex = this.moduleBuilder.addSignature([0x7f, 0x7f, 0x7f, 0x7f], [0x7f]);
        }
        this.indirectCallImportIdx = this.moduleBuilder.addFunctionImport('env', 'indirect_call', this.indirectCallSigIndex, 'indirect_call');
        return this.indirectCallImportIdx;
    }

    prepareModule(functions: CFGFunction[]) {
        const ops=functions.flatMap(f=>f.basicBlocks.flatMap(b=>b.instructions));
        const addMath=(name:string,params:number[])=>this.x87Imports.set(name,this.moduleBuilder.addFunctionImport('env',name,this.moduleBuilder.addSignature(params,[0x7c])));
        if (ops.some(i=>i.mnemonic==='FCOS')) addMath('aot_cos',[0x7c]);
        if (ops.some(i=>i.mnemonic==='FLD' && /extended double/.test(i.ops))) addMath('aot_load_f80',[0x7f]);

        let hasIndirectCall = false;

        for (let i = 0; i < functions.length; i++) {
            const entryAddr = parseInt(functions[i].entry, 16);
            this.funcEntryMap.set(entryAddr, i);
        }

        for (const fn of functions) {
            for (const bb of fn.basicBlocks) {
                for (const rawInst of bb.instructions) {
                    if (rawInst.mnemonic === 'CALL' || rawInst.mnemonic === 'JMP') {
                        const inst = parseInstruction(rawInst);
                        const [target] = inst.operands;
                        if (!target) continue;
                        if (target.kind === 'mem' && this.iatResolver && !target.base && !target.index) {
                            const entry = this.iatResolver.resolve(target.disp);
                            if (entry) {
                                this.getOrAddApiImport(entry.dll, entry.func);
                                continue;
                            }
                        }
                        if (target.kind === 'imm' && (
                            target.value === 0x687b7e || target.value === 0x68c215 || // alloca
                            target.value === 0x692cc3 || target.value === 0x692d08 || // SEH
                            this.funcEntryMap.has(target.value)
                        )) {
                            continue;
                        }
                        hasIndirectCall = true;
                    }
                }
            }
        }

        if (hasIndirectCall) {
            this.getOrAddIndirectCallImport();
        }
    }

    liftFunction(fn: CFGFunction): WasmFunctionBuilder {
        const entryAddr = parseInt(fn.entry, 16);
        if (!this.funcEntryMap.has(entryAddr)) {
            this.funcEntryMap.set(entryAddr, this.moduleBuilder.functions.length);
        }
        const wasmFn = this.moduleBuilder.addFunction(fn.name, this.funcSigIndex);

        // Locals: EDX, EBX, EBP, ESI, EDI, ZF, SF, CF, OF, TMP0, TMP1, BLOCK_ID (12 additional i32 locals)
        wasmFn.addLocals(12, 0x7f);
        // Locals: XMM0..XMM7, ST0..ST7, F32_TMP (17 additional f32 locals)
        wasmFn.addLocals(17, 0x7d);

        wasmFn.addLocals(1, 0x7f); // local 32: integer store scratch
        wasmFn.addLocals(1, 0x7d); // local 33: floating store scratch
        wasmFn.addLocals(2, 0x7f); // locals 34/35: comparison operands
        wasmFn.addLocals(1, 0x7f); // local 36: PF
        wasmFn.addLocals(2, 0x7c); // locals 37/38: x87 value and f64 store scratch
        wasmFn.addLocals(4, 0x7f); // locals 39..42: lane shuffle snapshot
        wasmFn.addLocals(1, 0x7e); // local 43: bit-preserving binary64 XMM store
        wasmFn.guestStoreF64Local = 38;
        wasmFn.guestMemoryBaseGlobal = this.memoryBaseGlobalIdx;
        wasmFn.guestStoreI32Local = 32;
        wasmFn.guestStoreF32Local = 33;

        // Synchronize ESP: if param $esp != 0, initialize global ESP; else load from global ESP
        wasmFn.local_get(LOCALS.ESP, 'esp');
        wasmFn.if_block(0x40);
        wasmFn.local_get(LOCALS.ESP);
        wasmFn.global_set(this.espGlobalIdx);
        wasmFn.else_block();
        wasmFn.global_get(this.espGlobalIdx);
        wasmFn.local_set(LOCALS.ESP);
        wasmFn.end();

        this.emitReloadRegisters(wasmFn, false);

        if (fn.basicBlocks.length <= 1) {
            // Straight-line single block
            const block = fn.basicBlocks[0];
            if (block) {
                this.liftBasicBlockInstructions(wasmFn, block);
            }
            // Return EAX & pop return address
            wasmFn.local_get(LOCALS.ESP);
            wasmFn.i32_const(4);
            wasmFn.i32_add();
            wasmFn.global_set(this.espGlobalIdx);
            this.emitPublishRegisters(wasmFn);
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

        // Fallback return EAX & pop return address
        wasmFn.local_get(LOCALS.ESP);
        wasmFn.i32_const(4);
        wasmFn.i32_add();
        wasmFn.global_set(this.espGlobalIdx);
        this.emitPublishRegisters(wasmFn);
        wasmFn.local_get(LOCALS.EAX, 'eax');
        wasmFn.return_op();

        return wasmFn;
    }

    private emitPublishRegisters(fn: WasmFunctionBuilder) {
        for (const [local, global] of this.registerGlobals) {
            fn.local_get(local); fn.global_set(global);
        }
    }

    private emitReloadRegisters(fn: WasmFunctionBuilder, includeEcx = true) {
        for (const [local, global] of this.registerGlobals) {
            if (!includeEcx && local === LOCALS.ECX) continue;
            fn.global_get(global); fn.local_set(local);
        }
    }

    private emitDebugWatchdog(fn: WasmFunctionBuilder, block: CFGBasicBlock) {
        if (this.debugFuel === undefined || this.debugPc === undefined) return;
        fn.i32_const(parseInt(block.start, 16)); fn.global_set(this.debugPc);
        fn.global_get(this.debugFuel); fn.i32_eqz(); fn.if_block(0x40);
        fn.emitBytes([0x00]); fn.watLines.push('    unreachable'); fn.end();
        fn.global_get(this.debugFuel); fn.i32_const(1); fn.i32_sub(); fn.global_set(this.debugFuel);
    }

    liftBasicBlockInstructions(fn: WasmFunctionBuilder, block: CFGBasicBlock) {
        this.emitDebugWatchdog(fn, block);
        for (const rawInst of block.instructions) {
            const inst = parseForLifting(rawInst);
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
        this.emitDebugWatchdog(fn, block);
        const insts = block.instructions.map(parseForLifting);
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
            // Use the same return path as straight-line functions: publish ESP
            // after popping the return address and any stdcall arguments.
            this.liftInstruction(fn, lastInst);
            return;
        }

        if (lastInst.mnemonic === 'JMP') {
            const target = lastInst.operands[0];
            const targetIdx = target?.kind === 'imm' ? blockMap.get(target.value) : undefined;
            if (targetIdx !== undefined) {
                fn.i32_const(targetIdx);
                fn.local_set(LOCALS.BLOCK_ID);
                fn.br(loopDepth);
                return;
            }

            // Dynamic jump (e.g. JMP [EAX*4 + table] or JMP reg)
            this.emitLoadOperandValue(fn, target);
            fn.local_set(LOCALS.TMP0);

            // Determine candidate internal block destinations (switch table targets)
            const computedDests = block.destinations
                ?.filter(d => d.type === 'COMPUTED_JUMP' || d.type === 'UNCONDITIONAL_JUMP')
                .map(d => parseInt(d.addr, 16))
                .filter(addr => blockMap.has(addr));

            const candidateAddrs = (computedDests && computedDests.length > 0)
                ? computedDests
                : Array.from(blockMap.keys());

            for (const addr of candidateAddrs) {
                const bIdx = blockMap.get(addr)!;
                fn.local_get(LOCALS.TMP0);
                fn.i32_const(addr);
                fn.i32_eq();
                fn.if_block(0x40);
                fn.i32_const(bIdx);
                fn.local_set(LOCALS.BLOCK_ID);
                fn.br(loopDepth + 1);
                fn.end();
            }

            // Not an internal block: genuine external tail-call
            fn.local_get(LOCALS.ESP);
            fn.global_set(this.espGlobalIdx);
            this.emitPublishRegisters(fn);
            if (target.kind === 'imm' && this.funcEntryMap.has(target.value)) {
                fn.i32_const(0);
                fn.local_get(LOCALS.ECX);
                fn.local_get(LOCALS.EAX);
                fn.call_func(this.moduleBuilder.getLocalFunctionIndex(this.funcEntryMap.get(target.value)!));
            } else {
                fn.local_get(LOCALS.TMP0);
                fn.local_get(LOCALS.ESP);
                fn.local_get(LOCALS.ECX);
                fn.local_get(LOCALS.EAX);
                fn.call_func(this.getOrAddIndirectCallImport());
            }
            fn.return_op();
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

        // Non-branch instructions, including the last one, were already emitted.
        // Re-emitting a terminal CALL executes it twice and corrupts the stack.
        const nextIdx = (blockIdx + 1) % numBlocks;
        fn.i32_const(nextIdx);
        fn.local_set(LOCALS.BLOCK_ID);
        fn.br(loopDepth);
    }

    emitTailCall(fn: WasmFunctionBuilder, target: Operand) {
        if (!target) throw new Error('JMP missing target');
        // Reuse the existing guest return address: JMP must not push another one.
        fn.local_get(LOCALS.ESP);
        fn.global_set(this.espGlobalIdx);
        this.emitPublishRegisters(fn);
        if (target.kind === 'imm' && this.funcEntryMap.has(target.value)) {
            fn.i32_const(0);
            fn.local_get(LOCALS.ECX);
            fn.local_get(LOCALS.EAX);
            fn.call_func(this.moduleBuilder.getLocalFunctionIndex(this.funcEntryMap.get(target.value)!));
        } else {
            this.emitLoadOperandValue(fn, target);
            fn.local_get(LOCALS.ESP);
            fn.local_get(LOCALS.ECX);
            fn.local_get(LOCALS.EAX);
            fn.call_func(this.getOrAddIndirectCallImport());
        }
        fn.return_op();
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
            case 'JP':
            case 'JPE':
                fn.local_get(36); break;
            case 'JNP':
            case 'JPO':
                fn.local_get(36); fn.i32_eqz(); break;
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
                // Unsupported conditions must not become unconditional jumps.
                fn.emitBytes([0x00]); fn.watLines.push(`    unreachable ;; unsupported ${mnemonic}`);
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
                // 1. Evaluate and load value BEFORE modifying ESP (vital for [ESP + offset] addressing!)
                this.emitLoadOperandValue(fn, src);
                fn.local_set(LOCALS.TMP0);

                // 2. esp = esp - 4
                fn.local_get(LOCALS.ESP);
                fn.i32_const(4);
                fn.i32_sub();
                fn.local_tee(LOCALS.ESP);

                // 3. mem[esp] = value
                fn.local_get(LOCALS.TMP0);
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
            case 'PUSHFD': case 'PUSHF': {
                fn.global_get(this.eflags);
                fn.i32_const(~0x08c5);
                fn.i32_and();
                fn.i32_const(0x0002);
                fn.i32_or();

                fn.local_get(LOCALS.CF);
                fn.i32_const(1);
                fn.i32_and();
                fn.i32_or();

                fn.local_get(36);
                fn.i32_const(1);
                fn.i32_and();
                fn.i32_const(2);
                fn.i32_shl();
                fn.i32_or();

                fn.local_get(LOCALS.ZF);
                fn.i32_const(1);
                fn.i32_and();
                fn.i32_const(6);
                fn.i32_shl();
                fn.i32_or();

                fn.local_get(LOCALS.SF);
                fn.i32_const(1);
                fn.i32_and();
                fn.i32_const(7);
                fn.i32_shl();
                fn.i32_or();

                fn.local_get(LOCALS.OF);
                fn.i32_const(1);
                fn.i32_and();
                fn.i32_const(11);
                fn.i32_shl();
                fn.i32_or();

                fn.local_set(LOCALS.TMP0);

                fn.local_get(LOCALS.ESP);
                fn.i32_const(4);
                fn.i32_sub();
                fn.local_tee(LOCALS.ESP);

                fn.local_get(LOCALS.TMP0);
                fn.i32_store(0, 2);
                break;
            }
            case 'POPFD': case 'POPF': {
                fn.local_get(LOCALS.ESP);
                fn.i32_load(0, 2);
                fn.local_set(LOCALS.TMP0);

                fn.local_get(LOCALS.ESP);
                fn.i32_const(4);
                fn.i32_add();
                fn.local_set(LOCALS.ESP);

                fn.local_get(LOCALS.TMP0);
                fn.i32_const(1);
                fn.i32_and();
                fn.local_set(LOCALS.CF);

                fn.local_get(LOCALS.TMP0);
                fn.i32_const(2);
                fn.i32_shr_u();
                fn.i32_const(1);
                fn.i32_and();
                fn.local_set(36);

                fn.local_get(LOCALS.TMP0);
                fn.i32_const(6);
                fn.i32_shr_u();
                fn.i32_const(1);
                fn.i32_and();
                fn.local_set(LOCALS.ZF);

                fn.local_get(LOCALS.TMP0);
                fn.i32_const(7);
                fn.i32_shr_u();
                fn.i32_const(1);
                fn.i32_and();
                fn.local_set(LOCALS.SF);

                fn.local_get(LOCALS.TMP0);
                fn.i32_const(11);
                fn.i32_shr_u();
                fn.i32_const(1);
                fn.i32_and();
                fn.local_set(LOCALS.OF);

                fn.local_get(LOCALS.TMP0);
                fn.i32_const(~0x08d5);
                fn.i32_and();
                fn.i32_const(0x0002);
                fn.i32_or();
                fn.global_set(this.eflags);
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
                const bits = dst.kind === 'imm' ? 32 : Math.min(dst.size * 8, 32);
                const mask = bits === 32 ? -1 : (1 << bits) - 1;
                this.emitLoadOperandValue(fn, dst);
                fn.i32_const(mask); fn.i32_and(); fn.local_set(34);
                this.emitLoadOperandValue(fn, src);
                fn.i32_const(mask); fn.i32_and(); fn.local_set(35);
                fn.local_get(34); fn.local_get(35); fn.i32_sub();
                fn.i32_const(mask); fn.i32_and(); fn.local_set(LOCALS.TMP0);
                fn.local_get(LOCALS.TMP0); fn.i32_eqz(); fn.local_set(LOCALS.ZF);
                fn.local_get(LOCALS.TMP0); fn.i32_const(1 << (bits - 1)); fn.i32_and();
                fn.i32_eqz(); fn.i32_eqz(); fn.local_set(LOCALS.SF);
                this.emitParity(fn);
                // Unsigned borrow
                fn.local_get(34); fn.local_get(35); fn.i32_lt_u(); fn.local_set(LOCALS.CF);
                // Signed subtraction overflow: (lhs ^ rhs) & (lhs ^ result)
                fn.local_get(34); fn.local_get(35); fn.i32_xor();
                fn.local_get(34); fn.local_get(LOCALS.TMP0); fn.i32_xor(); fn.i32_and();
                fn.i32_const(1 << (bits - 1)); fn.i32_and(); fn.i32_eqz(); fn.i32_eqz(); fn.local_set(LOCALS.OF);
                fn.local_get(LOCALS.TMP0);
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'CMP': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                const bits = dst.kind === 'imm' ? 32 : Math.min(dst.size * 8, 32);
                const mask = bits === 32 ? -1 : (1 << bits) - 1;
                this.emitLoadOperandValue(fn, dst);
                fn.i32_const(mask); fn.i32_and(); fn.local_set(34);
                this.emitLoadOperandValue(fn, src);
                fn.i32_const(mask); fn.i32_and(); fn.local_set(35);
                fn.local_get(34); fn.local_get(35); fn.i32_sub();
                fn.i32_const(mask); fn.i32_and(); fn.local_set(LOCALS.TMP0);
                fn.local_get(LOCALS.TMP0); fn.i32_eqz(); fn.local_set(LOCALS.ZF);
                fn.local_get(LOCALS.TMP0); fn.i32_const(1 << (bits - 1)); fn.i32_and();
                fn.i32_eqz(); fn.i32_eqz(); fn.local_set(LOCALS.SF);
                this.emitParity(fn);
                // Unsigned borrow, not the sign of the wrapped subtraction.
                fn.local_get(34); fn.local_get(35); fn.i32_lt_u(); fn.local_set(LOCALS.CF);
                // Signed subtraction overflow: (lhs ^ rhs) & (lhs ^ result).
                fn.local_get(34); fn.local_get(35); fn.i32_xor();
                fn.local_get(34); fn.local_get(LOCALS.TMP0); fn.i32_xor(); fn.i32_and();
                fn.i32_const(1 << (bits - 1)); fn.i32_and(); fn.i32_eqz(); fn.i32_eqz(); fn.local_set(LOCALS.OF);
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
            case 'LEAVE': {
                fn.local_get(LOCALS.EBP);fn.local_set(LOCALS.ESP);
                fn.local_get(LOCALS.ESP);fn.i32_load();fn.local_set(LOCALS.EBP);
                fn.local_get(LOCALS.ESP);fn.i32_const(4);fn.i32_add();fn.local_set(LOCALS.ESP);
                break;
            }
            case 'INC': case 'INC.LOCK': case 'DEC': case 'DEC.LOCK': {
                const [dst]=inst.operands;if(!dst || dst.kind==='imm')return;
                // Single guest-thread AOT: LOCK has no competing guest execution.
                const decrement=inst.mnemonic.startsWith('DEC');
                const bits=Math.min(dst.size*8,32),mask=bits===32?-1:(1<<bits)-1;
                this.emitLoadOperandValue(fn,dst);fn.i32_const(mask);fn.i32_and();fn.local_set(34);
                fn.local_get(34);fn.i32_const(1);if(decrement)fn.i32_sub();else fn.i32_add();
                fn.i32_const(mask);fn.i32_and();fn.local_set(LOCALS.TMP0);
                this.emitParity(fn);
                fn.local_get(LOCALS.TMP0);fn.i32_eqz();fn.local_set(LOCALS.ZF);
                fn.local_get(LOCALS.TMP0);fn.i32_const(1<<(bits-1));fn.i32_and();fn.i32_eqz();fn.i32_eqz();fn.local_set(LOCALS.SF);
                fn.local_get(34);fn.i32_const(decrement?1<<(bits-1):2**(bits-1)-1);fn.i32_eq();fn.local_set(LOCALS.OF);
                fn.global_get(this.eflags);fn.i32_const(~0x10);fn.i32_and();
                fn.local_get(34);fn.local_get(LOCALS.TMP0);fn.i32_xor();fn.i32_const(0x10);fn.i32_and();fn.i32_or();fn.global_set(this.eflags);
                fn.local_get(LOCALS.TMP0);this.emitStoreOperandValue(fn,dst);
                // INC/DEC preserve CF, including on wraparound.
                break;
            }
            case 'BT': {
                const [dst,index]=inst.operands;if(!dst || !index || dst.kind==='imm')return;
                const bits=dst.size===2?16:32;
                this.emitLoadOperandValue(fn,index);fn.local_set(35);
                if(dst.kind==='mem') {
                    this.emitEffectiveAddress(fn,dst);
                    // Register bit offsets address a signed bit string; immediates
                    // select a bit inside the operand-sized memory word.
                    if(index.kind!=='imm'){
                        fn.local_get(35);fn.i32_const(bits===16?4:5);fn.i32_shr_s();
                        fn.i32_const(bits===16?1:2);fn.i32_shl();fn.i32_add();
                    }
                    if(bits===16)fn.i32_load16_u();else fn.i32_load();
                }else this.emitLoadOperandValue(fn,dst);
                fn.local_get(35);fn.i32_const(bits-1);fn.i32_and();fn.i32_shr_u();
                fn.i32_const(1);fn.i32_and();fn.local_set(LOCALS.CF);break;
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
            case 'ROL': {
                const [dst, count] = inst.operands;
                if (!dst || !count) return;
                this.emitLoadOperandValue(fn, dst);
                this.emitLoadOperandValue(fn, count);
                fn.i32_rotl();
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'ROR': {
                const [dst, count] = inst.operands;
                if (!dst || !count) return;
                this.emitLoadOperandValue(fn, dst);
                this.emitLoadOperandValue(fn, count);
                fn.i32_rotr();
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'NEG': {
                const [dst] = inst.operands;
                if (!dst) return;
                const bits = dst.kind === 'imm' ? 32 : Math.min(dst.size * 8, 32);
                const mask = bits === 32 ? -1 : (1 << bits) - 1;
                this.emitLoadOperandValue(fn, dst);
                fn.i32_const(mask); fn.i32_and(); fn.local_set(34); // src in local 34
                fn.i32_const(0);
                fn.local_get(34);
                fn.i32_sub();
                fn.i32_const(mask); fn.i32_and(); fn.local_set(LOCALS.TMP0);
                fn.local_get(LOCALS.TMP0); fn.i32_eqz(); fn.local_set(LOCALS.ZF);
                fn.local_get(LOCALS.TMP0); fn.i32_const(1 << (bits - 1)); fn.i32_and();
                fn.i32_eqz(); fn.i32_eqz(); fn.local_set(LOCALS.SF);
                this.emitParity(fn);
                // CF = (src != 0)
                fn.local_get(34);
                fn.i32_const(0);
                fn.i32_ne();
                fn.local_set(LOCALS.CF);
                // OF = (src == min_int)
                fn.local_get(34);
                fn.i32_const(1 << (bits - 1));
                fn.i32_eq();
                fn.local_set(LOCALS.OF);

                fn.local_get(LOCALS.TMP0);
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'NOT': {
                const [dst] = inst.operands;
                if (!dst) return;
                this.emitLoadOperandValue(fn, dst);
                fn.i32_const(-1);
                fn.i32_xor();
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'CDQ': {
                fn.local_get(LOCALS.EAX);
                fn.i32_const(31);
                fn.i32_shr_s();
                fn.local_set(LOCALS.EDX);
                break;
            }
            case 'ADC': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                this.emitLoadOperandValue(fn, dst);
                this.emitLoadOperandValue(fn, src);
                fn.i32_add();
                fn.local_get(LOCALS.CF);
                fn.i32_add();
                fn.local_tee(LOCALS.TMP0);
                this.emitSetFlagsArithmetic(fn);
                fn.local_get(LOCALS.TMP0);
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'SBB': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                this.emitLoadOperandValue(fn, dst);
                this.emitLoadOperandValue(fn, src);
                fn.i32_sub();
                fn.local_get(LOCALS.CF);
                fn.i32_sub();
                fn.local_tee(LOCALS.TMP0);
                this.emitSetFlagsArithmetic(fn);
                fn.local_get(LOCALS.TMP0);
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'SETZ':
            case 'SETE': {
                const [dst] = inst.operands;
                if (!dst) return;
                fn.local_get(LOCALS.ZF);
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'SETNZ':
            case 'SETNE': {
                const [dst] = inst.operands;
                if (!dst) return;
                fn.local_get(LOCALS.ZF);
                fn.i32_eqz(); // 1 if ZF == 0
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'SETC':
            case 'SETB': {
                const [dst] = inst.operands;
                if (!dst) return;
                fn.local_get(LOCALS.CF);
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'SETLE':
            case 'SETNG': {
                const [dst] = inst.operands;
                if (!dst) return;
                this.emitJumpCondition(fn, 'JLE');
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'SETL':
            case 'SETNGE': {
                const [dst] = inst.operands;
                if (!dst) return;
                this.emitJumpCondition(fn, 'JL');
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'SETG':
            case 'SETNLE': {
                const [dst] = inst.operands;
                if (!dst) return;
                this.emitJumpCondition(fn, 'JG');
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'SETGE':
            case 'SETNL': {
                const [dst] = inst.operands;
                if (!dst) return;
                this.emitJumpCondition(fn, 'JGE');
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'SETO': {
                const [dst] = inst.operands;
                if (!dst) return;
                fn.local_get(LOCALS.OF);
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'MUL': {
                const [src] = inst.operands;
                if (!src) return;
                this.emitLoadOperandValue(fn, src);
                fn.local_set(LOCALS.TMP0);
                fn.local_get(LOCALS.EAX);
                fn.local_get(LOCALS.TMP0);
                fn.i32_mul();
                fn.local_set(LOCALS.EAX);
                break;
            }
            case 'DIV': {
                const [src] = inst.operands;
                if (!src) return;
                this.emitLoadOperandValue(fn, src);
                fn.local_set(LOCALS.TMP0);
                fn.local_get(LOCALS.EAX);
                fn.local_get(LOCALS.TMP0);
                fn.i32_div_u();
                fn.local_set(LOCALS.TMP1);
                fn.local_get(LOCALS.EAX);
                fn.local_get(LOCALS.TMP0);
                fn.i32_rem_u();
                fn.local_set(LOCALS.EDX);
                fn.local_get(LOCALS.TMP1);
                fn.local_set(LOCALS.EAX);
                break;
            }
            case 'IDIV': {
                const [src] = inst.operands;
                if (!src) return;
                this.emitLoadOperandValue(fn, src);
                fn.local_set(LOCALS.TMP0);
                fn.local_get(LOCALS.EAX);
                fn.local_get(LOCALS.TMP0);
                fn.i32_div_s();
                fn.local_set(LOCALS.TMP1);
                fn.local_get(LOCALS.EAX);
                fn.local_get(LOCALS.TMP0);
                fn.i32_rem_s();
                fn.local_set(LOCALS.EDX);
                fn.local_get(LOCALS.TMP1);
                fn.local_set(LOCALS.EAX);
                break;
            }
            // --- SSE Single-Precision Instructions ---
            case 'BSF':
            case 'BSR': {
                const [dst,src]=inst.operands;
                this.emitLoadOperandValue(fn,src);
                if(src.size===2){fn.i32_const(0xffff);fn.i32_and();}
                fn.local_set(34);fn.local_get(34);fn.i32_eqz();fn.local_set(LOCALS.ZF);
                fn.local_get(LOCALS.ZF);fn.i32_eqz();fn.if_block(0x40);
                if(inst.mnemonic==='BSR'){fn.i32_const(31);fn.local_get(34);fn.emitBytes([0x67]);fn.i32_sub();}
                else {fn.local_get(34);fn.emitBytes([0x68]);}
                this.emitStoreOperandValue(fn,dst);fn.end();
                // Other flags and the zero-source destination are architecturally undefined.
                break;
            }
            case 'CMPNLEPD': {
                const [dst,src]=inst.operands;
                for(let pair=0;pair<2;pair++){
                    this.emitXmmDoubleLoad(fn,dst,pair);this.emitXmmDoubleLoad(fn,src,pair);fn.f64_op(0x65,'f64.le');fn.i32_eqz();
                    fn.if_block(0x7f);fn.i32_const(-1);fn.else_block();fn.i32_const(0);fn.end();fn.local_set(39+pair);
                }
                for(let pair=0;pair<2;pair++)for(let half=0;half<2;half++){fn.local_get(39+pair);this.emitXmmLaneStore(fn,dst,pair*2+half);}
                break;
            }
            case 'PSLLQ':
            case 'PSRLQ': {
                const [dst,src]=inst.operands;
                if(this.xmmIndex(dst)===undefined){fn.i32_const(inst.addr);fn.global_set(this.unsupportedPc);fn.emitBytes([0x00]);break;}
                // Register counts use the entire low qword, not a masked shift count.
                if(src.kind==='imm'){fn.emitBytes([0x42,0x00]);fn.local_set(43);fn.i32_const(src.value>=64?64:src.value);fn.local_set(39);}
                else {
                    this.emitXmmLaneLoad(fn,src,0);fn.emitBytes([0xad]);
                    this.emitXmmLaneLoad(fn,src,1);fn.emitBytes([0xad,0x42,0x20,0x86,0x84]);fn.local_set(43);
                    fn.local_get(43);fn.emitBytes([0x42,0xc0,0x00,0x5a]);fn.if_block(0x7f);fn.i32_const(64);fn.else_block();fn.local_get(43);fn.emitBytes([0xa7]);fn.end();fn.local_set(39);
                }
                for(let pair=0;pair<2;pair++){
                    fn.local_get(39);fn.i32_const(64);fn.i32_ge_u();fn.if_block(0x7e);fn.emitBytes([0x42,0x00]);fn.else_block();
                    this.emitXmmLaneLoad(fn,dst,pair*2);fn.emitBytes([0xad]);this.emitXmmLaneLoad(fn,dst,pair*2+1);fn.emitBytes([0xad,0x42,0x20,0x86,0x84]);
                    fn.local_get(39);fn.emitBytes([0xad,inst.mnemonic==='PSLLQ'?0x86:0x88]);fn.end();fn.emitBytes([0xbf]);this.emitXmmDoubleStore(fn,dst,pair);
                }
                break;
            }
            case 'PSRLDQ': {
                const [dst,count]=inst.operands;
                if(count.kind!=='imm')throw new Error('PSRLDQ requires an immediate');
                for(let lane=0;lane<4;lane++){this.emitXmmLaneLoad(fn,dst,lane);fn.local_set(39+lane);}
                for(let lane=0;lane<4;lane++){
                    const bit=lane*32+count.value*8,index=Math.floor(bit/32),shift=bit%32;
                    if(index>=4)fn.i32_const(0);
                    else {
                        fn.local_get(39+index);if(shift){fn.i32_const(shift);fn.i32_shr_u();}
                        if(shift && index+1<4){fn.local_get(40+index);fn.i32_const(32-shift);fn.i32_shl();fn.i32_or();}
                    }this.emitXmmLaneStore(fn,dst,lane);
                }break;
            }
            case 'PUNPCKLBW':
            case 'PUNPCKLWD': {
                const [dst,src]=inst.operands;
                if(this.xmmIndex(dst)===undefined){fn.i32_const(inst.addr);fn.global_set(this.unsupportedPc);fn.emitBytes([0x00]);break;}
                for(let lane=0;lane<2;lane++){this.emitXmmLaneLoad(fn,dst,lane);fn.local_set(39+lane);this.emitXmmLaneLoad(fn,src,lane);fn.local_set(41+lane);}
                const width=inst.mnemonic==='PUNPCKLBW'?8:16, units=32/width;
                for(let lane=0;lane<4;lane++){
                    for(let unit=0;unit<units;unit++){
                        const element=Math.floor((lane*units+unit)/2),sourceLocal=(unit%2?41:39)+Math.floor(element/units);
                        fn.local_get(sourceLocal);fn.i32_const((element%units)*width);fn.i32_shr_u();fn.i32_const((1<<width)-1);fn.i32_and();
                        if(unit){fn.i32_const(unit*width);fn.i32_shl();fn.i32_or();}
                    }this.emitXmmLaneStore(fn,dst,lane);
                }break;
            }
            case 'PCMPEQW': {
                const [dst,src]=inst.operands;
                if(this.xmmIndex(dst)===undefined){fn.i32_const(inst.addr);fn.global_set(this.unsupportedPc);fn.emitBytes([0x00]);break;}
                for(let lane=0;lane<4;lane++){
                    this.emitXmmLaneLoad(fn,dst,lane);fn.local_set(34);this.emitXmmLaneLoad(fn,src,lane);fn.local_set(35);
                    for(let half=0;half<2;half++){
                        for(const operand of [34,35]){fn.local_get(operand);if(half){fn.i32_const(16);fn.i32_shr_u();}else{fn.i32_const(0xffff);fn.i32_and();}}
                        fn.i32_eq();fn.if_block(0x7f);fn.i32_const(half?-65536:65535);fn.else_block();fn.i32_const(0);fn.end();if(half)fn.i32_or();
                    }
                    this.emitXmmLaneStore(fn,dst,lane);
                }break;
            }
            case 'PMOVMSKB': {
                const [dst,src]=inst.operands;
                if(this.xmmIndex(src)===undefined){fn.i32_const(inst.addr);fn.global_set(this.unsupportedPc);fn.emitBytes([0x00]);break;}
                fn.i32_const(0);fn.local_set(39);
                for(let byte=0;byte<16;byte++){
                    fn.local_get(39);this.emitXmmLaneLoad(fn,src,byte>>>2);fn.i32_const((byte%4)*8+7);fn.i32_shr_u();fn.i32_const(1);fn.i32_and();fn.i32_const(byte);fn.i32_shl();fn.i32_or();fn.local_set(39);
                }fn.local_get(39);this.emitStoreOperandValue(fn,dst);break;
            }
            case 'ORPS':
            case 'ANDPD':
            case 'PSUBD': {
                const [dst,src]=inst.operands;
                if(this.xmmIndex(dst)===undefined){fn.i32_const(inst.addr);fn.global_set(this.unsupportedPc);fn.emitBytes([0x00]);break;}
                for(let lane=0;lane<4;lane++){
                    this.emitXmmLaneLoad(fn,dst,lane);this.emitXmmLaneLoad(fn,src,lane);
                    if(inst.mnemonic==='ANDPD')fn.i32_and();else if(inst.mnemonic==='ORPS')fn.i32_or();else fn.i32_sub();
                    this.emitXmmLaneStore(fn,dst,lane);
                }
                break;
            }
            case 'CVTDQ2PD': {
                const [dst,src]=inst.operands;
                for(let lane=0;lane<2;lane++){this.emitXmmLaneLoad(fn,src,lane);fn.local_set(39+lane);}
                for(let lane=0;lane<2;lane++){fn.local_get(39+lane);fn.f64_op(0xb7,'f64.convert_i32_s');this.emitXmmDoubleStore(fn,dst,lane);}
                break;
            }
            case 'ADDSD': {
                const [dst,src]=inst.operands;
                this.emitXmmDoubleLoad(fn,dst,0);this.emitXmmDoubleLoad(fn,src,0);
                fn.f64_op(0xa0,'f64.add');this.emitXmmDoubleStore(fn,dst,0);break;
            }
            case 'CVTPD2PS': {
                const [dst,src]=inst.operands;
                for(let lane=0;lane<2;lane++){this.emitXmmDoubleLoad(fn,src,lane);fn.local_set(37+lane);}
                for(let lane=0;lane<2;lane++){fn.local_get(37+lane);fn.f64_op(0xb6,'f32.demote_f64');fn.i32_reinterpret_f32();this.emitXmmLaneStore(fn,dst,lane);}
                for(let lane=2;lane<4;lane++){fn.i32_const(0);this.emitXmmLaneStore(fn,dst,lane);}
                break;
            }
            case 'PSHUFLW': {
                const [dst,src,control]=inst.operands;
                if(control.kind!=='imm')throw new Error('PSHUFLW requires an immediate');
                for(let lane=0;lane<4;lane++){this.emitXmmLaneLoad(fn,src,lane);fn.local_set(39+lane);}
                for(let lane=0;lane<2;lane++){
                    for(let half=0;half<2;half++){
                        const word=(control.value>>>((lane*2+half)*2))&3;
                        fn.local_get(39+(word>>>1));if(word&1){fn.i32_const(16);fn.i32_shr_u();}fn.i32_const(0xffff);fn.i32_and();
                        if(half){fn.i32_const(16);fn.i32_shl();fn.i32_or();}
                    }
                    this.emitXmmLaneStore(fn,dst,lane);
                }
                for(let lane=2;lane<4;lane++){fn.local_get(39+lane);this.emitXmmLaneStore(fn,dst,lane);}break;
            }
            case 'PSHUFD': {
                const [dst,src,control]=inst.operands;
                if(!dst || !src || !control || control.kind!=='imm')return;
                // Snapshot the source before writing; source and destination can alias.
                for(let lane=0;lane<4;lane++){this.emitXmmLaneLoad(fn,src,lane);fn.local_set(39+lane);}
                for(let lane=0;lane<4;lane++){fn.local_get(39+((control.value>>>(lane*2))&3));this.emitXmmLaneStore(fn,dst,lane);}
                break;
            }
            case 'MOVLPD': case 'MOVLPS': {
                this.emitXmmMove(fn,inst,2,false);break;
            }
            case 'MOVSS': {
                this.emitXmmMove(fn,inst,1,true);break;
            }
            case 'MOVAPS':
            case 'MOVAPD':
            case 'MOVUPS': case 'MOVUPD': case 'MOVDQU': case 'MOVDQA': {
                this.emitXmmMove(fn,inst,4,false);break;
            }
            case 'ADDSS': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                this.emitLoadFloatValue(fn, dst);
                this.emitLoadFloatValue(fn, src);
                fn.f32_add();
                this.emitStoreFloatValue(fn, dst);
                break;
            }
            case 'SUBSS': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                this.emitLoadFloatValue(fn, dst);
                this.emitLoadFloatValue(fn, src);
                fn.f32_sub();
                this.emitStoreFloatValue(fn, dst);
                break;
            }
            case 'MULSS': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                this.emitLoadFloatValue(fn, dst);
                this.emitLoadFloatValue(fn, src);
                fn.f32_mul();
                this.emitStoreFloatValue(fn, dst);
                break;
            }
            case 'DIVSS': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                this.emitLoadFloatValue(fn, dst);
                this.emitLoadFloatValue(fn, src);
                fn.f32_div();
                this.emitStoreFloatValue(fn, dst);
                break;
            }
            case 'COMISS': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                this.emitLoadFloatValue(fn, dst);
                this.emitLoadFloatValue(fn, src);
                fn.f32_lt();
                fn.local_set(LOCALS.CF);
                this.emitLoadFloatValue(fn, dst);
                this.emitLoadFloatValue(fn, src);
                fn.f32_eq();
                fn.local_set(LOCALS.ZF);
                break;
            }
            case 'CVTSI2SS': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                this.emitLoadOperandValue(fn, src);
                fn.f32_convert_i32_s();
                this.emitStoreFloatValue(fn, dst);
                break;
            }
            case 'CVTTSS2SI': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                this.emitLoadFloatValue(fn, src);
                fn.i32_trunc_f32_s();
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'XORPD': case 'XORPS': {
                const [dst,src] = inst.operands;
                if (!dst) return;
                if(this.xmmIndex(dst)!==undefined && src) {
                    for(let lane=0;lane<4;lane++) {
                        this.emitXmmLaneLoad(fn,dst,lane);this.emitXmmLaneLoad(fn,src,lane);
                        fn.i32_xor();this.emitXmmLaneStore(fn,dst,lane);
                    }
                    break;
                }
                fn.f32_const(0.0);
                this.emitStoreFloatValue(fn, dst);
                break;
            }
            // Shared x87 logical stack: values survive direct and indirect calls.
            case 'FLD': {
                const src=inst.operands[0]; if (!src) return;
                this.emitX87Load(fn,src); fn.local_set(37); this.emitX87Push(fn); break;
            }
            case 'FLD1': case 'FLDZ': {
                fn.f64_const(inst.mnemonic==='FLD1'?1:0);fn.local_set(37);this.emitX87Push(fn);break;
            }
            case 'FILD': {
                const src=inst.operands[0];if(!src)return;
                if(src.kind!=='imm' && src.size>4) {fn.emitBytes([0x00]);break;}
                this.emitLoadOperandValue(fn,src);fn.f64_op(0xb7,'f64.convert_i32_s');fn.local_set(37);this.emitX87Push(fn);break;
            }
            case 'FST': case 'FSTP': {
                const dst=inst.operands[0];if(!dst)return;
                fn.global_get(this.x87Stack[0]);this.emitX87Store(fn,dst);
                if(inst.mnemonic==='FSTP')this.emitX87Pop(fn);break;
            }
            case 'FISTP': {
                const dst=inst.operands[0];if(!dst)return;
                fn.global_get(this.x87Stack[0]);fn.local_set(37);
                for(let mode=0;mode<3;mode++){
                    fn.global_get(this.x87Control);fn.i32_const(10);fn.i32_shr_u();fn.i32_const(3);fn.i32_and();fn.i32_const(mode);fn.i32_eq();fn.if_block(0x7c);
                    fn.local_get(37);fn.f64_op([0x9e,0x9c,0x9b][mode],['f64.nearest','f64.floor','f64.ceil'][mode]);fn.else_block();
                }
                fn.local_get(37);fn.f64_op(0x9d,'f64.trunc');for(let n=0;n<3;n++)fn.end();
                fn.f64_op(0xaa,'i32.trunc_f64_s');this.emitStoreOperandValue(fn,dst);this.emitX87Pop(fn);break;
            }
            case 'FADD': case 'FADDP': case 'FIADD':
            case 'FSUB': case 'FSUBP': case 'FSUBRP':
            case 'FMUL': case 'FMULP': case 'FDIV': case 'FDIVP': case 'FDIVR': case 'FDIVRP': {
                const operands=inst.operands;
                const pop=inst.mnemonic.endsWith('P');
                const dst=operands.length>1?operands[0]:null;
                const src=operands.length>1?operands[1]:operands[0];
                const index=dst?.kind==='reg'&&dst.baseReg.startsWith('ST')?Number(dst.baseReg.slice(2)):(pop?1:0);
                const reverse=inst.mnemonic==='FSUBRP'||inst.mnemonic==='FDIVR'||inst.mnemonic==='FDIVRP';
                const loadSrc=()=>{if(src)this.emitX87Load(fn,src,inst.mnemonic==='FIADD');else fn.global_get(this.x87Stack[0]);};
                if(reverse){loadSrc();fn.global_get(this.x87Stack[index]);}else{fn.global_get(this.x87Stack[index]);loadSrc();}
                const op=inst.mnemonic.startsWith('FA')||inst.mnemonic==='FIADD'?0xa0:inst.mnemonic.startsWith('FS')?0xa1:inst.mnemonic.startsWith('FM')?0xa2:0xa3;
                fn.f64_op(op,['f64.add','f64.sub','f64.mul','f64.div'][op-0xa0]);fn.global_set(this.x87Stack[index]);
                if(pop)this.emitX87Pop(fn);break;
            }
            case 'FCHS': case 'FABS': case 'FSQRT': {
                fn.global_get(this.x87Stack[0]);const op=inst.mnemonic==='FCHS'?0x9a:inst.mnemonic==='FABS'?0x99:0x9f;
                fn.f64_op(op,inst.mnemonic);fn.global_set(this.x87Stack[0]);break;
            }
            case 'FXCH': {
                const src=inst.operands[0];const index=src?.kind==='reg'?Number(src.baseReg.slice(2)):1;
                fn.global_get(this.x87Stack[0]);fn.local_set(37);fn.global_get(this.x87Stack[index]);fn.global_set(this.x87Stack[0]);fn.local_get(37);fn.global_set(this.x87Stack[index]);break;
            }
            case 'FCOS': {
                // Infinity needs unsupported invalid-operation handling, not C2 range success.
                fn.global_get(this.x87Stack[0]);fn.f64_op(0x99,'f64.abs');fn.f64_const(Infinity);fn.f64_op(0x61,'f64.eq');
                fn.if_block(0x40);fn.emitBytes([0x00]);fn.end();
                // Intel C2 reports an argument outside the hardware reduction range.
                fn.global_get(this.x87Stack[0]);fn.f64_op(0x99,'f64.abs');fn.f64_const(2**63);fn.f64_op(0x66,'f64.ge');
                fn.if_block(0x40);fn.global_get(this.x87Status);fn.i32_const(0x400);fn.i32_or();fn.global_set(this.x87Status);
                fn.else_block();fn.global_get(this.x87Stack[0]);fn.call_func(this.x87Imports.get('aot_cos')!);fn.global_set(this.x87Stack[0]);
                fn.global_get(this.x87Status);fn.i32_const(~0x400);fn.i32_and();fn.global_set(this.x87Status);fn.end();break;
            }
            case 'FSTCW': case 'FNSTCW': {
                const dst=inst.operands[0];if(!dst)return;fn.global_get(this.x87Control);this.emitStoreOperandValue(fn,dst);break;
            }
            case 'FLDCW': {
                const src=inst.operands[0];if(!src)return;this.emitLoadOperandValue(fn,src);fn.global_set(this.x87Control);break;
            }
            case 'FSTSW': case 'FNSTSW': {
                const dst=inst.operands[0];if(!dst)return;
                fn.global_get(this.x87Status);fn.i32_const(~0x3800);fn.i32_and();fn.global_get(this.x87Top);fn.i32_const(11);fn.i32_shl();fn.i32_or();this.emitStoreOperandValue(fn,dst);break;
            }
            case 'FCLEX': case 'FNCLEX': {
                fn.global_get(this.x87Status);
                fn.i32_const(0x7f00);
                fn.i32_and();
                fn.global_set(this.x87Status);
                break;
            }
            case 'SAHF': {
                for(const [bit,local] of [[0,LOCALS.CF],[2,36],[6,LOCALS.ZF],[7,LOCALS.SF]]) {
                    fn.local_get(LOCALS.EAX);fn.i32_const(8+bit);fn.i32_shr_u();fn.i32_const(1);fn.i32_and();fn.local_set(local);
                }break;
            }
            case 'CPUID': {
                fn.local_get(LOCALS.EAX);
                fn.i32_eqz();
                fn.if_block(0x40);
                // Leaf 0: Maximum Basic Leaf = 1, Vendor = "GenuineIntel"
                // EBX: "Genu" (0x756e6547)
                // EDX: "ineI" (0x49656e69)
                // ECX: "ntel" (0x6c65746e)
                fn.i32_const(1); fn.local_set(LOCALS.EAX);
                fn.i32_const(0x756e6547); fn.local_set(LOCALS.EBX);
                fn.i32_const(0x49656e69); fn.local_set(LOCALS.EDX);
                fn.i32_const(0x6c65746e); fn.local_set(LOCALS.ECX);
                fn.else_block();
                fn.local_get(LOCALS.EAX);
                fn.i32_const(1);
                fn.i32_eq();
                fn.if_block(0x40);
                // Leaf 1: Family/Model signature, features (including SSE2 in EDX bit 26: 0x04000000)
                fn.i32_const(0x00010676); fn.local_set(LOCALS.EAX);
                fn.i32_const(0x00020800); fn.local_set(LOCALS.EBX);
                fn.i32_const(0x00000209); fn.local_set(LOCALS.ECX);
                fn.i32_const(0x078bfbfd); fn.local_set(LOCALS.EDX);
                fn.else_block();
                fn.i32_const(0); fn.local_set(LOCALS.EAX);
                fn.i32_const(0); fn.local_set(LOCALS.EBX);
                fn.i32_const(0); fn.local_set(LOCALS.ECX);
                fn.i32_const(0); fn.local_set(LOCALS.EDX);
                fn.end();
                fn.end();
                break;
            }
            case 'FPREM1': case 'FCOMP': case 'FCOMIP':
                // Explicit unsupported behavior, rather than fabricated status/results.
                fn.i32_const(inst.addr);fn.global_set(this.unsupportedPc);
                fn.emitBytes([0x00]); break;
            case 'CMOVZ': case 'CMOVE': case 'CMOVNZ': case 'CMOVNE': {
                this.emitConditionalMove(fn,inst);break;
            }
            case 'CMOVC': case 'CMOVNC':
            case 'CMOVA': case 'CMOVAE': case 'CMOVB': case 'CMOVBE':
            case 'CMOVL': case 'CMOVLE': case 'CMOVG': case 'CMOVGE':
            case 'CMOVS': case 'CMOVNS': case 'CMOVP': case 'CMOVNP': {
                this.emitConditionalMove(fn,inst);break;
            }
            case 'XCHG': {
                let [dst,src]=inst.operands;
                if(!dst || !src)return;
                // Store memory before changing a register used by its address.
                if(src.kind==='mem') [dst,src]=[src,dst];
                this.emitLoadOperandValue(fn,dst);fn.local_set(34);
                this.emitLoadOperandValue(fn,src);fn.local_set(35);
                fn.local_get(35);this.emitStoreOperandValue(fn,dst);
                fn.local_get(34);this.emitStoreOperandValue(fn,src);
                // XCHG preserves arithmetic flags. AOT currently has one guest thread.
                break;
            }
            case 'XADD':
            case 'XADD.LOCK': {
                // AOT currently runs on one worker. No guest thread can race
                // this read/write pair until multi-threaded AOT is implemented.
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                const bits = dst.kind === 'imm' ? 32 : Math.min(dst.size * 8, 32);
                const mask = bits === 32 ? -1 : (1 << bits) - 1;
                this.emitLoadOperandValue(fn, dst);
                fn.i32_const(mask); fn.i32_and(); fn.local_set(34);
                this.emitLoadOperandValue(fn, src);
                fn.i32_const(mask); fn.i32_and(); fn.local_set(35);
                fn.local_get(34); fn.local_get(35); fn.i32_add();
                fn.i32_const(mask); fn.i32_and(); fn.local_set(LOCALS.TMP0);
                fn.local_get(LOCALS.TMP0); fn.i32_eqz(); fn.local_set(LOCALS.ZF);
                fn.local_get(LOCALS.TMP0); fn.i32_const(1 << (bits - 1)); fn.i32_and();
                fn.i32_eqz(); fn.i32_eqz(); fn.local_set(LOCALS.SF);
                fn.local_get(LOCALS.TMP0); fn.local_get(34); fn.i32_lt_u(); fn.local_set(LOCALS.CF);
                fn.local_get(34); fn.local_get(35); fn.i32_xor(); fn.i32_const(-1); fn.i32_xor();
                fn.local_get(34); fn.local_get(LOCALS.TMP0); fn.i32_xor(); fn.i32_and();
                fn.i32_const(1 << (bits - 1)); fn.i32_and(); fn.i32_eqz(); fn.i32_eqz(); fn.local_set(LOCALS.OF);
                fn.local_get(LOCALS.TMP0); this.emitStoreOperandValue(fn, dst);
                fn.local_get(34); this.emitStoreOperandValue(fn, src);
                break;
            }
            case 'CMPXCHG.LOCK': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                this.emitLoadOperandValue(fn, dst);
                fn.local_tee(LOCALS.TMP0);
                fn.local_get(LOCALS.EAX);
                fn.i32_eq();
                fn.if_block(0x40);
                this.emitLoadOperandValue(fn, src);
                this.emitStoreOperandValue(fn, dst);
                fn.i32_const(1);
                fn.local_set(LOCALS.ZF);
                fn.else_block();
                fn.local_get(LOCALS.TMP0);
                fn.local_set(LOCALS.EAX);
                fn.i32_const(0);
                fn.local_set(LOCALS.ZF);
                fn.end();
                break;
            }
            case 'STOSB.REP': {
                fn.block(0x40, '$stosb_end');
                fn.loop(0x40, '$stosb_loop');
                fn.local_get(LOCALS.ECX);
                fn.i32_eqz();
                fn.br_if(1);
                fn.local_get(LOCALS.EDI);
                fn.local_get(LOCALS.EAX);
                fn.i32_store8(0, 0);
                fn.local_get(LOCALS.EDI);
                fn.i32_const(1);
                fn.i32_add();
                fn.local_set(LOCALS.EDI);
                fn.local_get(LOCALS.ECX);
                fn.i32_const(1);
                fn.i32_sub();
                fn.local_set(LOCALS.ECX);
                fn.br(0);
                fn.end();
                fn.end();
                break;
            }
            case 'STOSW.REP': {
                fn.block(0x40, '$stosw_end');
                fn.loop(0x40, '$stosw_loop');
                fn.local_get(LOCALS.ECX);
                fn.i32_eqz();
                fn.br_if(1);
                fn.local_get(LOCALS.EDI);
                fn.local_get(LOCALS.EAX);
                fn.i32_store16(0, 1);
                fn.local_get(LOCALS.EDI);
                fn.i32_const(2);
                fn.i32_add();
                fn.local_set(LOCALS.EDI);
                fn.local_get(LOCALS.ECX);
                fn.i32_const(1);
                fn.i32_sub();
                fn.local_set(LOCALS.ECX);
                fn.br(0);
                fn.end();
                fn.end();
                break;
            }
            case 'STOSD': {
                fn.local_get(LOCALS.EDI);
                fn.local_get(LOCALS.EAX);
                fn.i32_store(0, 2);
                fn.local_get(LOCALS.EDI);
                fn.i32_const(4);
                fn.i32_add();
                fn.local_set(LOCALS.EDI);
                break;
            }
            case 'STOSD.REP': {
                fn.block(0x40, '$stosd_end');
                fn.loop(0x40, '$stosd_loop');
                fn.local_get(LOCALS.ECX);
                fn.i32_eqz();
                fn.br_if(1);
                fn.local_get(LOCALS.EDI);
                fn.local_get(LOCALS.EAX);
                fn.i32_store(0, 2);
                fn.local_get(LOCALS.EDI);
                fn.i32_const(4);
                fn.i32_add();
                fn.local_set(LOCALS.EDI);
                fn.local_get(LOCALS.ECX);
                fn.i32_const(1);
                fn.i32_sub();
                fn.local_set(LOCALS.ECX);
                fn.br(0);
                fn.end();
                fn.end();
                break;
            }
            case 'CLD': case 'STD': {
                fn.global_get(this.eflags); fn.i32_const(inst.mnemonic === 'CLD' ? ~0x400 : 0x400);
                if (inst.mnemonic === 'CLD') fn.i32_and(); else fn.i32_or();
                fn.global_set(this.eflags); break;
            }
            case 'MOVSD': case 'MOVSD.REP': {
                // A5 string-copy form; SSE MOVSD with XMM operands is a separate instruction.
                if (/XMM/i.test(inst.rawOps)) {
                    this.emitXmmMove(fn,inst,2,true);break;
                }
                const repeated = inst.mnemonic === 'MOVSD.REP';
                if (repeated) {
                    fn.block(0x40); fn.loop(0x40);
                    fn.local_get(LOCALS.ECX); fn.i32_eqz(); fn.br_if(1);
                }
                fn.local_get(LOCALS.EDI); fn.local_get(LOCALS.ESI); fn.i32_load(); fn.i32_store();
                fn.global_get(this.eflags); fn.i32_const(0x400); fn.i32_and();
                fn.if_block(0x7f); fn.i32_const(-4); fn.else_block(); fn.i32_const(4); fn.end();
                fn.local_set(LOCALS.TMP0);
                for (const reg of [LOCALS.ESI, LOCALS.EDI]) {
                    fn.local_get(reg); fn.local_get(LOCALS.TMP0); fn.i32_add(); fn.local_set(reg);
                }
                if (repeated) {
                    fn.local_get(LOCALS.ECX); fn.i32_const(1); fn.i32_sub(); fn.local_set(LOCALS.ECX);
                    fn.br(0); fn.end(); fn.end();
                }
                break;
            }
            case 'MOVSB': {
                fn.local_get(LOCALS.EDI);
                fn.local_get(LOCALS.ESI);
                fn.i32_load8_u(0, 0);
                fn.i32_store8(0, 0);
                fn.local_get(LOCALS.ESI); fn.i32_const(1); fn.i32_add(); fn.local_set(LOCALS.ESI);
                fn.local_get(LOCALS.EDI); fn.i32_const(1); fn.i32_add(); fn.local_set(LOCALS.EDI);
                break;
            }
            case 'MOVSB.REP': {
                fn.block(0x40, '$movsb_end');
                fn.loop(0x40, '$movsb_loop');
                fn.local_get(LOCALS.ECX);
                fn.i32_eqz();
                fn.br_if(1);
                fn.local_get(LOCALS.EDI);
                fn.local_get(LOCALS.ESI);
                fn.i32_load8_u(0, 0);
                fn.i32_store8(0, 0);
                fn.local_get(LOCALS.ESI); fn.i32_const(1); fn.i32_add(); fn.local_set(LOCALS.ESI);
                fn.local_get(LOCALS.EDI); fn.i32_const(1); fn.i32_add(); fn.local_set(LOCALS.EDI);
                fn.local_get(LOCALS.ECX); fn.i32_const(1); fn.i32_sub(); fn.local_set(LOCALS.ECX);
                fn.br(0);
                fn.end();
                fn.end();
                break;
            }
            case 'MOVSD.REP': {
                fn.block(0x40, '$movsd_end');
                fn.loop(0x40, '$movsd_loop');
                fn.local_get(LOCALS.ECX);
                fn.i32_eqz();
                fn.br_if(1);
                fn.local_get(LOCALS.EDI);
                fn.local_get(LOCALS.ESI);
                fn.i32_load(0, 2);
                fn.i32_store(0, 2);
                fn.local_get(LOCALS.ESI); fn.i32_const(4); fn.i32_add(); fn.local_set(LOCALS.ESI);
                fn.local_get(LOCALS.EDI); fn.i32_const(4); fn.i32_add(); fn.local_set(LOCALS.EDI);
                fn.local_get(LOCALS.ECX); fn.i32_const(1); fn.i32_sub(); fn.local_set(LOCALS.ECX);
                fn.br(0);
                fn.end();
                fn.end();
                break;
            }
            case 'SCASB.REPNE': {
                fn.block(0x40, '$scasb_end');
                fn.loop(0x40, '$scasb_loop');
                fn.local_get(LOCALS.ECX);
                fn.i32_eqz();
                fn.br_if(1);
                fn.local_get(LOCALS.EDI);
                fn.i32_load8_u(0, 0);
                fn.local_get(LOCALS.EAX);
                fn.i32_const(0xff);
                fn.i32_and();
                fn.i32_sub();
                fn.local_tee(LOCALS.TMP0);
                fn.i32_eqz();
                fn.local_set(LOCALS.ZF);
                fn.local_get(LOCALS.EDI); fn.i32_const(1); fn.i32_add(); fn.local_set(LOCALS.EDI);
                fn.local_get(LOCALS.ECX); fn.i32_const(1); fn.i32_sub(); fn.local_set(LOCALS.ECX);
                fn.local_get(LOCALS.ZF);
                fn.br_if(1);
                fn.br(0);
                fn.end();
                fn.end();
                break;
            }
            case 'RDTSC': {
                fn.i32_const(0);
                fn.local_set(LOCALS.EAX);
                fn.i32_const(0);
                fn.local_set(LOCALS.EDX);
                break;
            }
            case 'PXOR': {
                const [dst,src] = inst.operands;
                if (!dst) return;
                if(this.xmmIndex(dst)!==undefined && src) {
                    for(let lane=0;lane<4;lane++) {
                        this.emitXmmLaneLoad(fn,dst,lane);this.emitXmmLaneLoad(fn,src,lane);
                        fn.i32_xor();this.emitXmmLaneStore(fn,dst,lane);
                    }
                    break;
                }
                fn.f32_const(0.0);
                this.emitStoreFloatValue(fn, dst);
                break;
            }
            case 'MOVQ': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                if(this.xmmIndex(dst)!==undefined || this.xmmIndex(src)!==undefined){
                    this.emitXmmMove(fn,inst,2,false);
                    if(this.xmmIndex(dst)!==undefined)for(let lane=2;lane<4;lane++){fn.i32_const(0);this.emitXmmLaneStore(fn,dst,lane);}
                    break;
                }
                this.emitLoadFloatValue(fn, src);
                this.emitStoreFloatValue(fn, dst);
                break;
            }
            case 'MOVD': {
                const [dst, src] = inst.operands;
                if (!dst || !src) return;
                if(this.xmmIndex(dst)!==undefined) {
                    this.emitLoadOperandValue(fn,src);this.emitXmmLaneStore(fn,dst,0);
                    for(let lane=1;lane<4;lane++){fn.i32_const(0);this.emitXmmLaneStore(fn,dst,lane);}
                    break;
                }
                if(this.xmmIndex(src)!==undefined) {
                    this.emitXmmLaneLoad(fn,src,0);this.emitStoreOperandValue(fn,dst);break;
                }
                if (dst.kind === 'reg' && src.kind === 'reg') {
                    const srcIsFloat = isFloatReg(src.baseReg);
                    const dstIsFloat = isFloatReg(dst.baseReg);
                    fn.local_get(REG_TO_LOCAL[src.baseReg]);
                    if (srcIsFloat && !dstIsFloat) {
                        fn.i32_reinterpret_f32();
                    } else if (!srcIsFloat && dstIsFloat) {
                        fn.f32_reinterpret_i32();
                    }
                    fn.local_set(REG_TO_LOCAL[dst.baseReg]);
                } else if (dst.kind === 'reg') {
                    const dstIsFloat = isFloatReg(dst.baseReg);
                    if (dstIsFloat) {
                        this.emitLoadFloatValue(fn, src);
                        fn.local_set(REG_TO_LOCAL[dst.baseReg]);
                    } else {
                        this.emitLoadOperandValue(fn, src);
                        this.emitStoreOperandValue(fn, dst);
                    }
                } else if (src.kind === 'reg') {
                    const srcIsFloat = isFloatReg(src.baseReg);
                    if (srcIsFloat) {
                        fn.local_get(REG_TO_LOCAL[src.baseReg]);
                        this.emitStoreFloatValue(fn, dst);
                    } else {
                        fn.local_get(REG_TO_LOCAL[src.baseReg]);
                        this.emitStoreOperandValue(fn, dst);
                    }
                }
                break;
            }
            case 'STMXCSR': {
                const [dst] = inst.operands;
                if (!dst) return;
                fn.global_get(this.mxcsr);
                this.emitStoreOperandValue(fn, dst);
                break;
            }
            case 'LDMXCSR': {
                const [src] = inst.operands;
                if (!src) return;
                this.emitLoadOperandValue(fn, src);
                fn.global_set(this.mxcsr);
                break;
            }
            case 'PUNPCKHDQ': {
                // Interleave MMX high dwords (stub)
                break;
            }
            case 'NOP':
                fn.nop();
                break;
            case 'JMP': {
                this.emitTailCall(fn, inst.operands[0]);
                break;
            }
            case 'RET': {
                let imm = 0;
                if (inst.operands.length > 0 && inst.operands[0].kind === 'imm') {
                    imm = inst.operands[0].value;
                }
                // Pop return address (+4) and callee arguments (+imm)
                fn.local_get(LOCALS.ESP);
                fn.i32_const(imm + 4);
                fn.i32_add();
                fn.global_set(this.espGlobalIdx);
                this.emitPublishRegisters(fn);
                fn.local_get(LOCALS.EAX);
                fn.return_op();
                break;
            }
            case 'CALL': {
                const [target] = inst.operands;
                if (!target) return;

                if (target.kind === 'mem' && this.iatResolver) {
                    const entry = this.iatResolver.resolve(target.disp);
                    if (entry) {
                        const importIdx = this.getOrAddApiImport(entry.dll, entry.func);
                        fn.comment(`Direct IAT Call: ${entry.dll}!${entry.func}`);
                        // Push return address: esp = esp - 4; mem[esp] = retAddr
                        fn.local_get(LOCALS.ESP);
                        fn.i32_const(4);
                        fn.i32_sub();
                        fn.local_tee(LOCALS.ESP);
                        fn.i32_const(inst.addr + inst.len);
                        fn.i32_store(0, 2);

                        // Sync global ESP before call
                        fn.local_get(LOCALS.ESP);
                        fn.global_set(this.espGlobalIdx);
                        this.emitPublishRegisters(fn);

                        // Call imported API with esp
                        fn.local_get(LOCALS.ESP);
                        fn.call_func(importIdx, `win32_${entry.dll}_${entry.func}`);
                        fn.local_set(LOCALS.EAX);

                        // Sync local ESP from global ESP (which includes callee stack cleanup)
                        fn.global_get(this.espGlobalIdx);
                        fn.local_set(LOCALS.ESP);
                        this.emitReloadRegisters(fn);
                        return;
                    }
                }


                // 2. Direct internal function call: CALL imm
                if (target.kind === 'imm') {
                    // __alloca_probe / __alloca_probe_16: ESP = ESP - EAX
                    if (target.value === 0x687b7e || target.value === 0x68c215) {
                        fn.comment('Inlined compiler helper: __alloca_probe (ESP = ESP - EAX)');
                        fn.local_get(LOCALS.ESP);
                        fn.local_get(LOCALS.EAX);
                        fn.i32_sub();
                        fn.local_set(LOCALS.ESP);
                        return;
                    }

                    // __SEH_prolog4: Sets up caller's EBP, allocates stack frame, registers SEH
                    if (target.value === 0x692cc3) {
                        fn.comment('Inlined compiler helper: __SEH_prolog4');
                        const tebBase = this.options.tebAddress ?? 0x00030000;

                        // Save scope_table from [ESP] into TMP1
                        fn.local_get(LOCALS.ESP);
                        fn.i32_load(0, 2);
                        fn.local_set(LOCALS.TMP1);

                        // Save frame_size from [ESP + 4] into TMP0
                        fn.local_get(LOCALS.ESP);
                        fn.i32_const(4);
                        fn.i32_add();
                        fn.i32_load(0, 2);
                        fn.local_set(LOCALS.TMP0);

                        // Save caller's current EBP into [ESP + 4]
                        fn.local_get(LOCALS.ESP);
                        fn.i32_const(4);
                        fn.i32_add();
                        fn.local_get(LOCALS.EBP);
                        fn.i32_store(0, 2);

                        // Set caller's new EBP = ESP + 4
                        fn.local_get(LOCALS.ESP);
                        fn.i32_const(4);
                        fn.i32_add();
                        fn.local_set(LOCALS.EBP);

                        // Native prolog saves three GPRs and a cookie; inline CALL/RET nets 0x1c bytes.
                        fn.local_get(LOCALS.ESP);
                        fn.local_get(LOCALS.TMP0);
                        fn.i32_sub();
                        fn.i32_const(0x1c);
                        fn.i32_sub();
                        fn.local_set(LOCALS.ESP);
                        for (const [reg, offset] of [[LOCALS.EBX,12],[LOCALS.ESI,8],[LOCALS.EDI,4]]) {
                            fn.local_get(LOCALS.ESP); fn.i32_const(offset); fn.i32_add();
                            fn.local_get(reg); fn.i32_store();
                        }
                        fn.local_get(LOCALS.ESP); fn.i32_const(0x868b38); fn.i32_load();
                        fn.local_get(LOCALS.EBP); fn.i32_xor(); fn.i32_store();
                        fn.local_get(LOCALS.EBP); fn.i32_const(0x18); fn.i32_sub();
                        fn.local_get(LOCALS.ESP); fn.i32_store();

                        // [EBP - 4] = 0xfffffffe (-2, _trylevel)
                        fn.local_get(LOCALS.EBP);
                        fn.i32_const(4);
                        fn.i32_sub();
                        fn.i32_const(-2);
                        fn.i32_store(0, 2);

                        // [EBP - 8] = scope_table (TMP1)
                        fn.local_get(LOCALS.EBP);
                        fn.i32_const(8);
                        fn.i32_sub();
                        fn.local_get(LOCALS.TMP1);
                        fn.i32_store(0, 2);

                        // [EBP - 0xc] = 0x68900b (_except_handler4)
                        fn.local_get(LOCALS.EBP);
                        fn.i32_const(0xc);
                        fn.i32_sub();
                        fn.i32_const(0x68900b);
                        fn.i32_store(0, 2);

                        // [EBP - 0x10] = old FS:[0]
                        fn.local_get(LOCALS.EBP);
                        fn.i32_const(0x10);
                        fn.i32_sub();
                        fn.i32_const(tebBase);
                        fn.i32_load(0, 2);
                        fn.i32_store(0, 2);

                        // Update FS:[0] = EBP - 0x10
                        fn.i32_const(tebBase);
                        fn.local_get(LOCALS.EBP);
                        fn.i32_const(0x10);
                        fn.i32_sub();
                        fn.i32_store(0, 2);
                        return;
                    }

                    // __SEH_epilog4: Restores old FS:[0], restores ESP and EBP
                    if (target.value === 0x692d08) {
                        fn.comment('Inlined compiler helper: __SEH_epilog4');
                        const tebBase = this.options.tebAddress ?? 0x00030000;

                        // Restore FS:[0] = [EBP - 0x10]
                        fn.i32_const(tebBase);
                        fn.local_get(LOCALS.EBP);
                        fn.i32_const(0x10);
                        fn.i32_sub();
                        fn.i32_load(0, 2);
                        fn.i32_store(0, 2);

                        // Undo the prolog's actual register saves, after the cookie.
                        for (const [reg, offset] of [[LOCALS.EDI,4],[LOCALS.ESI,8],[LOCALS.EBX,12]]) {
                            fn.local_get(LOCALS.ESP); fn.i32_const(offset); fn.i32_add();
                            fn.i32_load(); fn.local_set(reg);
                        }
                        // Native epilog restores ESP=EBP then pops saved EBP.
                        // The helper's own CALL/RET is inlined; the caller RET
                        // still needs to pop its return address at EBP+4.
                        fn.local_get(LOCALS.EBP);
                        fn.i32_const(4);
                        fn.i32_add();
                        fn.local_set(LOCALS.ESP);

                        // EBP = [EBP] (restore caller's old EBP)
                        fn.local_get(LOCALS.EBP);
                        fn.i32_load(0, 2);
                        fn.local_set(LOCALS.EBP);
                        return;
                    }
                }

                if (target.kind === 'imm' && this.funcEntryMap.has(target.value)) {
                    const targetLocalIdx = this.funcEntryMap.get(target.value)!;
                    const targetWasmIdx = this.moduleBuilder.getLocalFunctionIndex(targetLocalIdx);
                    fn.comment(`Internal Function Call: 0x${target.value.toString(16)} (wasm func ${targetWasmIdx})`);

                    // Push return address: esp = esp - 4; mem[esp] = retAddr
                    fn.local_get(LOCALS.ESP);
                    fn.i32_const(4);
                    fn.i32_sub();
                    fn.local_tee(LOCALS.ESP);
                    fn.i32_const(inst.addr + inst.len);
                    fn.i32_store(0, 2);

                    // Sync global ESP before call
                    fn.local_get(LOCALS.ESP);
                    fn.global_set(this.espGlobalIdx);
                    this.emitPublishRegisters(fn);

                    // Call internal function with (0, ecx, eax) -> callee loads from global ESP
                    fn.i32_const(0);
                    fn.local_get(LOCALS.ECX);
                    fn.local_get(LOCALS.EAX);
                    fn.call_func(targetWasmIdx, `fn_0x${target.value.toString(16)}`);
                    fn.local_set(LOCALS.EAX);

                    // Sync local ESP from global ESP
                    fn.global_get(this.espGlobalIdx);
                    fn.local_set(LOCALS.ESP);
                    this.emitReloadRegisters(fn);
                    return;
                }

                // 4. Indirect Function Call: CALL reg / CALL [mem] / unresolved CALL imm
                const indirectIdx = this.getOrAddIndirectCallImport();
                fn.comment(`Indirect Function Call: ${inst.rawOps}`);

                // Compute target address BEFORE modifying ESP!
                if (target.kind === 'reg') {
                    fn.local_get(REG_TO_LOCAL[target.baseReg]);
                } else if (target.kind === 'mem') {
                    this.emitEffectiveAddress(fn, target);
                    fn.i32_load(0, 2);
                } else if (target.kind === 'imm') {
                    fn.i32_const(target.value);
                }
                fn.local_set(LOCALS.TMP0);

                // Push return address: esp = esp - 4; mem[esp] = retAddr
                fn.local_get(LOCALS.ESP);
                fn.i32_const(4);
                fn.i32_sub();
                fn.local_tee(LOCALS.ESP);
                fn.i32_const(inst.addr + inst.len);
                fn.i32_store(0, 2);

                // Sync global ESP before call
                fn.local_get(LOCALS.ESP);
                fn.global_set(this.espGlobalIdx);
                this.emitPublishRegisters(fn);

                // Arguments to indirect_call: (targetAddr, esp, ecx, eax)
                fn.local_get(LOCALS.TMP0);
                fn.local_get(LOCALS.ESP);
                fn.local_get(LOCALS.ECX);
                fn.local_get(LOCALS.EAX);
                fn.call_func(indirectIdx, 'indirect_call');
                fn.local_set(LOCALS.EAX);

                // Sync local ESP from global ESP
                fn.global_get(this.espGlobalIdx);
                fn.local_set(LOCALS.ESP);
                this.emitReloadRegisters(fn);
                return;

            }
            default:
                fn.comment(`UNHANDLED: ${inst.mnemonic} ${inst.rawOps}`);
                fn.i32_const(inst.addr);fn.global_set(this.unsupportedPc);
                fn.emitBytes([0x00]);fn.watLines.push('    unreachable');
                break;
        }
    }

    private emitParity(fn: WasmFunctionBuilder) {
        fn.local_get(LOCALS.TMP0);fn.i32_const(0xff);fn.i32_and();fn.emitByte(0x69);fn.watLines.push('    i32.popcnt');
        fn.i32_const(1);fn.i32_and();fn.i32_eqz();fn.local_set(36);
    }
    emitSetFlagsLogic(fn: WasmFunctionBuilder) {
        this.emitParity(fn);
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
        this.emitParity(fn);
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

    private emitX87Push(fn: WasmFunctionBuilder) {
        for(let n=7;n>0;n--){fn.global_get(this.x87Stack[n-1]);fn.global_set(this.x87Stack[n]);}
        fn.local_get(37);fn.global_set(this.x87Stack[0]);
        fn.global_get(this.x87Top);fn.i32_const(1);fn.i32_sub();fn.i32_const(7);fn.i32_and();fn.global_set(this.x87Top);
    }
    private emitX87Pop(fn: WasmFunctionBuilder) {
        for(let n=0;n<7;n++){fn.global_get(this.x87Stack[n+1]);fn.global_set(this.x87Stack[n]);}
        fn.f64_const(0);fn.global_set(this.x87Stack[7]);
        fn.global_get(this.x87Top);fn.i32_const(1);fn.i32_add();fn.i32_const(7);fn.i32_and();fn.global_set(this.x87Top);
    }
    private emitX87Load(fn: WasmFunctionBuilder, op: Operand, integer=false) {
        if(op.kind==='reg'&&op.baseReg.startsWith('ST')){fn.global_get(this.x87Stack[Number(op.baseReg.slice(2))]);return;}
        if(integer){this.emitLoadOperandValue(fn,op);fn.f64_op(0xb7,'f64.convert_i32_s');return;}
        if(op.kind!=='mem'){fn.emitBytes([0x00]);return;}
        this.emitEffectiveAddress(fn,op);
        if(op.size===10)fn.call_func(this.x87Imports.get('aot_load_f80')!);
        else if(op.size===8)fn.f64_load();
        else if(op.size===4){fn.f32_load();fn.f64_op(0xbb,'f64.promote_f32');}
        else fn.emitBytes([0x00]);
    }
    private emitX87Store(fn: WasmFunctionBuilder, op: Operand) {
        if(op.kind==='reg'&&op.baseReg.startsWith('ST')){fn.global_set(this.x87Stack[Number(op.baseReg.slice(2))]);return;}
        if(op.kind!=='mem'){fn.emitBytes([0x00]);return;}
        fn.local_set(37);this.emitEffectiveAddress(fn,op);fn.local_get(37);
        if(op.size===8)fn.f64_store();
        else if(op.size===4){fn.f64_op(0xb6,'f32.demote_f64');fn.f32_store();}
        else fn.emitBytes([0x00]);
    }

    emitEffectiveAddress(fn: WasmFunctionBuilder, mem: MemoryOperand) {
        const segBase = mem.segment === 'FS' ? (this.options.tebAddress ?? 0x00030000) : 0;

        if (!mem.base && !mem.index) {
            const finalAddr = (mem.disp + segBase) >>> 0;
            fn.i32_const(finalAddr, `addr 0x${finalAddr.toString(16)}`);
            return;
        }

        if (mem.base && !mem.index) {
            fn.local_get(REG_TO_LOCAL[mem.base]);
            const totalDisp = mem.disp + segBase;
            if (totalDisp !== 0) {
                fn.i32_const(totalDisp);
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
            const totalDisp = mem.disp + segBase;
            if (totalDisp !== 0) {
                fn.i32_const(totalDisp);
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
            const totalDisp = mem.disp + segBase;
            if (totalDisp !== 0) {
                fn.i32_const(totalDisp);
                fn.i32_add();
            }
            return;
        }
    }

    private emitConditionalMove(fn: WasmFunctionBuilder, inst: ParsedInstruction) {
        const [dst,src]=inst.operands;if(!dst || !src)return;
        this.emitLoadOperandValue(fn,src);fn.local_set(34);
        this.emitJumpCondition(fn,'J'+inst.mnemonic.slice(4));
        fn.if_block(0x40);fn.local_get(34);this.emitStoreOperandValue(fn,dst);fn.end();
    }

    private xmmIndex(op: Operand): number | undefined {
        return op.kind==='reg' && /^XMM[0-7]$/.test(op.baseReg) ? Number(op.baseReg.slice(3)) : undefined;
    }

    private emitXmmDoubleLoad(fn: WasmFunctionBuilder, op: Operand, pair: number) {
        if(op.kind==='mem'){this.emitEffectiveAddress(fn,op);fn.f64_load(pair*8,0);return;}
        this.emitXmmLaneLoad(fn,op,pair*2);fn.emitBytes([0xad]);
        this.emitXmmLaneLoad(fn,op,pair*2+1);fn.emitBytes([0xad,0x42,0x20,0x86,0x84,0xbf]);
    }

    private emitXmmDoubleStore(fn: WasmFunctionBuilder, op: Operand, pair: number) {
        fn.emitBytes([0xbd]);fn.local_set(43);
        fn.local_get(43);fn.emitBytes([0xa7]);this.emitXmmLaneStore(fn,op,pair*2);
        fn.local_get(43);fn.emitBytes([0x42,0x20,0x88,0xa7]);this.emitXmmLaneStore(fn,op,pair*2+1);
    }

    private emitXmmLaneLoad(fn: WasmFunctionBuilder, op: Operand, lane: number) {
        const reg=this.xmmIndex(op);
        if(reg!==undefined){fn.global_get(this.xmmLanes[reg][lane]);return;}
        if(op.kind==='mem'){this.emitEffectiveAddress(fn,op);fn.i32_load(lane*4,0);return;}
        throw new Error('Invalid XMM lane source');
    }

    private emitXmmLaneStore(fn: WasmFunctionBuilder, op: Operand, lane: number) {
        const reg=this.xmmIndex(op);
        if(reg!==undefined){fn.global_set(this.xmmLanes[reg][lane]);return;}
        if(op.kind==='mem'){
            fn.local_set(32);this.emitEffectiveAddress(fn,op);fn.local_get(32);fn.i32_store(lane*4,0);return;
        }
        throw new Error('Invalid XMM lane destination');
    }

    private emitXmmMove(fn: WasmFunctionBuilder, inst: ParsedInstruction, lanes: number, clearMemoryLoadUpper: boolean) {
        const [dst,src]=inst.operands;
        if(!dst || !src || (this.xmmIndex(dst)===undefined && this.xmmIndex(src)===undefined)) {
            fn.i32_const(inst.addr);fn.global_set(this.unsupportedPc);fn.emitBytes([0x00]);return;
        }
        for(let lane=0;lane<lanes;lane++){this.emitXmmLaneLoad(fn,src,lane);this.emitXmmLaneStore(fn,dst,lane);}
        if(clearMemoryLoadUpper && src.kind==='mem' && this.xmmIndex(dst)!==undefined){
            for(let lane=lanes;lane<4;lane++){fn.i32_const(0);this.emitXmmLaneStore(fn,dst,lane);}
        }
    }

    emitLoadOperandValue(fn: WasmFunctionBuilder, op: Operand) {
        if(this.xmmIndex(op)!==undefined){this.emitXmmLaneLoad(fn,op,0);return;}
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

    emitLoadFloatValue(fn: WasmFunctionBuilder, op: Operand) {
        if(this.xmmIndex(op)!==undefined){this.emitXmmLaneLoad(fn,op,0);fn.f32_reinterpret_i32();return;}
        if (op.kind === 'imm') {
            fn.f32_const(op.value);
            return;
        }
        if (op.kind === 'reg') {
            const localIdx = REG_TO_LOCAL[op.baseReg];
            fn.local_get(localIdx, op.name);
            return;
        }
        if (op.kind === 'mem') {
            this.emitEffectiveAddress(fn, op);
            fn.f32_load(0, 2);
            return;
        }
    }

    emitStoreFloatValue(fn: WasmFunctionBuilder, dst: Operand) {
        if(this.xmmIndex(dst)!==undefined){fn.i32_reinterpret_f32();this.emitXmmLaneStore(fn,dst,0);return;}
        if (dst.kind === 'reg') {
            const localIdx = REG_TO_LOCAL[dst.baseReg];
            fn.local_set(localIdx, dst.name);
            return;
        }
        if (dst.kind === 'mem') {
            fn.local_set(LOCALS.F32_TMP);
            this.emitEffectiveAddress(fn, dst);
            if (dst.size === 16) {
                fn.local_set(LOCALS.TMP0);
                for (const off of [0, 4, 8, 12]) {
                    fn.local_get(LOCALS.TMP0);
                    if (off > 0) {
                        fn.i32_const(off);
                        fn.i32_add();
                    }
                    fn.local_get(LOCALS.F32_TMP);
                    fn.f32_store(0, 2);
                }
            } else {
                fn.local_get(LOCALS.F32_TMP);
                fn.f32_store(0, 2);
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
    lifter.prepareModule(cfgExport.functions);
    const seenNames = new Set<string>();
    for (let i = 0; i < cfgExport.functions.length; i++) {
        const fn = cfgExport.functions[i];
        lifter.liftFunction(fn);
        let exportName = fn.name;
        if (seenNames.has(exportName)) {
            exportName = `${fn.name}_${fn.entry}`;
        }
        seenNames.add(exportName);
        lifter.moduleBuilder.addExport(exportName, 0, i);
        lifter.moduleBuilder.addExport(`addr_${fn.entry}`, 0, i);
    }

    return {
        builder: lifter.moduleBuilder,
        wasmBytes: lifter.moduleBuilder.toBinary(),
        watText: options.emitWat !== false ? lifter.moduleBuilder.toWat() : '',
    };

}
