/**
 * types.ts — Type definitions for Halo 2 Static Recompiler.
 */

export interface CFGInstruction {
    addr: string;
    len: number;
    mnemonic: string;
    ops: string;
}

export interface CFGDestination {
    addr: string;
    type: string; // 'FALL_THROUGH' | 'CONDITIONAL_JUMP' | 'UNCONDITIONAL_JUMP' | etc.
}

export interface CFGBasicBlock {
    start: string;
    end: string;
    instructions: CFGInstruction[];
    destinations: CFGDestination[];
}

export interface CFGFunction {
    name: string;
    entry: string;
    rva: string;
    size: number;
    basicBlocks: CFGBasicBlock[];
}

export interface CFGExport {
    program: string;
    imageBase: string;
    functions: CFGFunction[];
}

export type GpRegisterName = 'EAX' | 'ECX' | 'EDX' | 'EBX' | 'ESP' | 'EBP' | 'ESI' | 'EDI';
export type XmmRegisterName = 'XMM0' | 'XMM1' | 'XMM2' | 'XMM3' | 'XMM4' | 'XMM5' | 'XMM6' | 'XMM7';
export type FpuRegisterName = 'ST0' | 'ST1' | 'ST2' | 'ST3' | 'ST4' | 'ST5' | 'ST6' | 'ST7';
export type SegmentRegisterName = 'ES' | 'DS' | 'FS' | 'GS' | 'CS' | 'SS';

export type BaseRegisterName = GpRegisterName | XmmRegisterName | FpuRegisterName | SegmentRegisterName;

export interface RegisterOperand {
    kind: 'reg';
    name: string;
    baseReg: BaseRegisterName;
    size: 1 | 2 | 4 | 8 | 16;
    highByte?: boolean; // true for AH, CH, DH, BH
    segment?: SegmentRegisterName;
}

export interface ImmediateOperand {
    kind: 'imm';
    value: number;
}

export interface MemoryOperand {
    kind: 'mem';
    size: 1 | 2 | 4 | 8 | 16;
    segment?: SegmentRegisterName;
    base?: BaseRegisterName;
    index?: BaseRegisterName;
    scale?: number; // 1, 2, 4, 8
    disp: number;
}

export type Operand = RegisterOperand | ImmediateOperand | MemoryOperand;

export interface ParsedInstruction {
    addr: number;
    len: number;
    mnemonic: string;
    operands: Operand[];
    rawOps: string;
}

export interface LiftedModuleOptions {
    importMemory?: boolean;
    memoryPages?: number; // default 32768 (2GB) or 16 (1MB for unit tests)
    exportMemory?: boolean;
    moduleName?: string;
    iatResolver?: any;
}

