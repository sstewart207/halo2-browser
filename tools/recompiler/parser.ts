/**
 * parser.ts — Parses Ghidra x86 disassembly operand strings into structured typed operands.
 */

import {
    BaseRegisterName,
    MemoryOperand,
    Operand,
    ParsedInstruction,
    RegisterOperand,
    ImmediateOperand,
    CFGInstruction,
    SegmentRegisterName
} from './types';

const REG_MAP: Record<string, { base: BaseRegisterName; size: 1 | 2 | 4 | 8 | 16; high?: boolean }> = {
    // 32-bit GP
    EAX: { base: 'EAX', size: 4 },
    ECX: { base: 'ECX', size: 4 },
    EDX: { base: 'EDX', size: 4 },
    EBX: { base: 'EBX', size: 4 },
    ESP: { base: 'ESP', size: 4 },
    EBP: { base: 'EBP', size: 4 },
    ESI: { base: 'ESI', size: 4 },
    EDI: { base: 'EDI', size: 4 },
    // 16-bit GP
    AX: { base: 'EAX', size: 2 },
    CX: { base: 'ECX', size: 2 },
    DX: { base: 'EDX', size: 2 },
    BX: { base: 'EBX', size: 2 },
    SP: { base: 'ESP', size: 2 },
    BP: { base: 'EBP', size: 2 },
    SI: { base: 'ESI', size: 2 },
    DI: { base: 'EDI', size: 2 },
    // 8-bit low GP
    AL: { base: 'EAX', size: 1 },
    CL: { base: 'ECX', size: 1 },
    DL: { base: 'EDX', size: 1 },
    BL: { base: 'EBX', size: 1 },
    // 8-bit high GP
    AH: { base: 'EAX', size: 1, high: true },
    CH: { base: 'ECX', size: 1, high: true },
    DH: { base: 'EDX', size: 1, high: true },
    BH: { base: 'EBX', size: 1, high: true },
    // SSE registers (128-bit)
    XMM0: { base: 'XMM0', size: 16 },
    XMM1: { base: 'XMM1', size: 16 },
    XMM2: { base: 'XMM2', size: 16 },
    XMM3: { base: 'XMM3', size: 16 },
    XMM4: { base: 'XMM4', size: 16 },
    XMM5: { base: 'XMM5', size: 16 },
    XMM6: { base: 'XMM6', size: 16 },
    XMM7: { base: 'XMM7', size: 16 },
    // x87 FPU stack registers
    ST0: { base: 'ST0', size: 8 },
    ST1: { base: 'ST1', size: 8 },
    ST2: { base: 'ST2', size: 8 },
    ST3: { base: 'ST3', size: 8 },
    ST4: { base: 'ST4', size: 8 },
    ST5: { base: 'ST5', size: 8 },
    ST6: { base: 'ST6', size: 8 },
    ST7: { base: 'ST7', size: 8 },
    // MMX registers (64-bit)
    MM0: { base: 'MM0', size: 8 },
    MM1: { base: 'MM1', size: 8 },
    MM2: { base: 'MM2', size: 8 },
    MM3: { base: 'MM3', size: 8 },
    MM4: { base: 'MM4', size: 8 },
    MM5: { base: 'MM5', size: 8 },
    MM6: { base: 'MM6', size: 8 },
    MM7: { base: 'MM7', size: 8 },
    // Segment registers
    ES: { base: 'ES', size: 2 },
    DS: { base: 'DS', size: 2 },
    FS: { base: 'FS', size: 2 },
    GS: { base: 'GS', size: 2 },
    CS: { base: 'CS', size: 2 },
    SS: { base: 'SS', size: 2 },
};

function parseNumber(s: string): number | null {
    s = s.trim();
    if (!s) return null;
    let sign = 1;
    if (s.startsWith('-')) {
        sign = -1;
        s = s.substring(1).trim();
    } else if (s.startsWith('+')) {
        s = s.substring(1).trim();
    }

    if (s.startsWith('0x') || s.startsWith('0X')) {
        const val = parseInt(s, 16);
        return isNaN(val) ? null : sign * val;
    }
    if (/^\d+$/.test(s)) {
        const val = parseInt(s, 10);
        return isNaN(val) ? null : sign * val;
    }
    return null;
}

export function parseOperand(opStr: string, defaultSize: 1 | 2 | 4 | 8 | 16 = 4): Operand {
    opStr = opStr.trim();

    // Check segment override prefix and size prefix in any order
    let segment: SegmentRegisterName | undefined;
    let size: 1 | 2 | 4 | 8 | 16 = defaultSize;

    let changed = true;
    while (changed) {
        changed = false;
        const segMatch = opStr.match(/^(ES|DS|FS|GS|CS|SS):/i);
        if (segMatch) {
            segment = segMatch[1].toUpperCase() as SegmentRegisterName;
            opStr = opStr.substring(segMatch[0].length).trim();
            changed = true;
            continue;
        }

        if (opStr.startsWith('dword ptr ')) {
            size = 4;
            opStr = opStr.substring(10).trim();
            changed = true;
        } else if (opStr.startsWith('float ptr ')) {
            size = 4;
            opStr = opStr.substring(10).trim();
            changed = true;
        } else if (opStr.startsWith('word ptr ')) {
            size = 2;
            opStr = opStr.substring(9).trim();
            changed = true;
        } else if (opStr.startsWith('byte ptr ')) {
            size = 1;
            opStr = opStr.substring(9).trim();
            changed = true;
        } else if (opStr.startsWith('qword ptr ')) {
            size = 8;
            opStr = opStr.substring(10).trim();
            changed = true;
        } else if (opStr.startsWith('double ptr ')) {
            size = 8;
            opStr = opStr.substring(11).trim();
            changed = true;
        } else if (opStr.startsWith('xmmword ptr ') || opStr.startsWith('dqword ptr ')) {
            size = 16;
            opStr = opStr.substring(opStr.indexOf('ptr ') + 4).trim();
            changed = true;
        } else if (opStr.startsWith('extended double ptr ') || opStr.startsWith('tbyte ptr ')) {
            size = 8;
            opStr = opStr.substring(opStr.indexOf('ptr ') + 4).trim();
            changed = true;
        }
    }

    // Memory operand: [...]
    if (opStr.startsWith('[') && opStr.endsWith(']')) {
        const inner = opStr.substring(1, opStr.length - 1).trim();
        return parseMemoryExpression(inner, size, segment);
    }

    // Register operand (normalize ST(0) -> ST0)
    const upperOp = opStr.toUpperCase().replace(/^ST\((\d)\)$/, 'ST$1');
    if (REG_MAP[upperOp]) {
        const info = REG_MAP[upperOp];
        return {
            kind: 'reg',
            name: upperOp,
            baseReg: info.base,
            size: info.size,
            highByte: info.high,
            segment,
        };
    }

    // Immediate operand
    const num = parseNumber(opStr);
    if (num !== null) {
        return {
            kind: 'imm',
            value: num,
        };
    }

    // Fallback: treated as immediate (e.g. symbol address or raw hex)
    const hexMatch = opStr.match(/0x[0-9a-fA-F]+/);
    if (hexMatch) {
        return {
            kind: 'imm',
            value: parseInt(hexMatch[0], 16),
        };
    }

    throw new Error(`Unrecognized operand: "${opStr}"`);
}

function parseMemoryExpression(expr: string, size: 1 | 2 | 4 | 8 | 16, segment?: SegmentRegisterName): MemoryOperand {
    // Normalise '+' and '-'
    // E.g. "ESP + -0x4", "EDX + ECX*0x4 + 0xc", "0x0086d894", "ESP"
    let base: BaseRegisterName | undefined;
    let index: BaseRegisterName | undefined;
    let scale: number | undefined;
    let disp = 0;

    // Split on '+' or '-' while preserving signs
    // Replace ' + ' with '+', ' - ' with '+-', then split on '+'
    const normalized = expr
        .replace(/\s*\+\s*-/g, '+-')
        .replace(/\s*-\s*/g, '+-')
        .replace(/\s*\+\s*/g, '+');

    const parts = normalized.split('+').map(p => p.trim()).filter(Boolean);

    for (const part of parts) {
        // Check for index * scale: e.g. ECX*0x4, ECX*4, EDI*0x1
        if (part.includes('*')) {
            const [regPart, scalePart] = part.split('*').map(s => s.trim());
            const regUpper = regPart.toUpperCase();
            if (REG_MAP[regUpper]) {
                index = REG_MAP[regUpper].base;
                scale = parseNumber(scalePart) ?? 1;
                continue;
            }
        }

        // Check for pure register
        const partUpper = part.toUpperCase();
        if (REG_MAP[partUpper]) {
            if (!base) {
                base = REG_MAP[partUpper].base;
            } else if (!index) {
                index = REG_MAP[partUpper].base;
                scale = 1;
            }
            continue;
        }

        // Check for number / displacement
        const num = parseNumber(part);
        if (num !== null) {
            disp += num;
            continue;
        }
    }

    return {
        kind: 'mem',
        size,
        segment,
        base,
        index,
        scale,
        disp,
    };
}

export function parseInstruction(inst: CFGInstruction): ParsedInstruction {
    const rawOps = inst.ops ? inst.ops.trim() : '';
    const operands: Operand[] = [];

    if (rawOps.length > 0) {
        // Split comma-separated operands (without splitting commas inside brackets)
        const parts: string[] = [];
        let cur = '';
        let bracketDepth = 0;

        for (let i = 0; i < rawOps.length; i++) {
            const ch = rawOps[i];
            if (ch === '[') bracketDepth++;
            else if (ch === ']') bracketDepth--;

            if (ch === ',' && bracketDepth === 0) {
                parts.push(cur.trim());
                cur = '';
            } else {
                cur += ch;
            }
        }
        if (cur.trim()) {
            parts.push(cur.trim());
        }

        // Infer default memory size from first register operand if available
        let firstRegSize: 1 | 2 | 4 | 8 | 16 = 4;
        for (const p of parts) {
            const upper = p.toUpperCase();
            if (REG_MAP[upper]) {
                firstRegSize = REG_MAP[upper].size;
                break;
            }
        }

        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;
            operands.push(parseOperand(trimmed, firstRegSize));
        }
    }

    return {
        addr: parseInt(inst.addr, 16),
        len: inst.len,
        mnemonic: inst.mnemonic.toUpperCase(),
        operands,
        rawOps,
    };
}
