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
    CFGInstruction
} from './types';

const REG_MAP: Record<string, { base: BaseRegisterName; size: 1 | 2 | 4; high?: boolean }> = {
    // 32-bit
    EAX: { base: 'EAX', size: 4 },
    ECX: { base: 'ECX', size: 4 },
    EDX: { base: 'EDX', size: 4 },
    EBX: { base: 'EBX', size: 4 },
    ESP: { base: 'ESP', size: 4 },
    EBP: { base: 'EBP', size: 4 },
    ESI: { base: 'ESI', size: 4 },
    EDI: { base: 'EDI', size: 4 },
    // 16-bit
    AX: { base: 'EAX', size: 2 },
    CX: { base: 'ECX', size: 2 },
    DX: { base: 'EDX', size: 2 },
    BX: { base: 'EBX', size: 2 },
    SP: { base: 'ESP', size: 2 },
    BP: { base: 'EBP', size: 2 },
    SI: { base: 'ESI', size: 2 },
    DI: { base: 'EDI', size: 2 },
    // 8-bit low
    AL: { base: 'EAX', size: 1 },
    CL: { base: 'ECX', size: 1 },
    DL: { base: 'EDX', size: 1 },
    BL: { base: 'EBX', size: 1 },
    // 8-bit high
    AH: { base: 'EAX', size: 1, high: true },
    CH: { base: 'ECX', size: 1, high: true },
    DH: { base: 'EDX', size: 1, high: true },
    BH: { base: 'EBX', size: 1, high: true },
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

export function parseOperand(opStr: string, defaultSize: 1 | 2 | 4 = 4): Operand {
    opStr = opStr.trim();

    // Check memory size prefix
    let size: 1 | 2 | 4 = defaultSize;
    if (opStr.startsWith('dword ptr ')) {
        size = 4;
        opStr = opStr.substring(10).trim();
    } else if (opStr.startsWith('word ptr ')) {
        size = 2;
        opStr = opStr.substring(9).trim();
    } else if (opStr.startsWith('byte ptr ')) {
        size = 1;
        opStr = opStr.substring(9).trim();
    }

    // Memory operand: [...]
    if (opStr.startsWith('[') && opStr.endsWith(']')) {
        const inner = opStr.substring(1, opStr.length - 1).trim();
        return parseMemoryExpression(inner, size);
    }

    // Register operand
    const upperOp = opStr.toUpperCase();
    if (REG_MAP[upperOp]) {
        const info = REG_MAP[upperOp];
        return {
            kind: 'reg',
            name: upperOp,
            baseReg: info.base,
            size: info.size,
            highByte: info.high,
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

function parseMemoryExpression(expr: string, size: 1 | 2 | 4): MemoryOperand {
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
        let firstRegSize: 1 | 2 | 4 = 4;
        for (const p of parts) {
            const upper = p.toUpperCase();
            if (REG_MAP[upper]) {
                firstRegSize = REG_MAP[upper].size;
                break;
            }
        }

        for (const part of parts) {
            operands.push(parseOperand(part, firstRegSize));
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
