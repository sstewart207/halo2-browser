import {DEFAULT_LEN, Op, opName} from './sm-enums';

/** Read DXSO through END at an instruction boundary, never inside comment/immediate data. */
export function readShaderTokens(memory: Uint8Array, ptr: number, maxTokens = 8192): Uint32Array {
    const view = new DataView(memory.buffer, memory.byteOffset, memory.byteLength);
    if (!Number.isInteger(ptr) || ptr < 0 || ptr + 4 > memory.byteLength) throw new Error('Invalid shader address');
    const available = Math.min(maxTokens, Math.floor((memory.byteLength - ptr) / 4));
    const read = (n: number) => view.getUint32(ptr + n * 4, true);
    const version = read(0);
    const kind = version >>> 16;
    if (kind !== 0xfffe && kind !== 0xffff) throw new Error('Invalid shader version token');
    const major = (version >>> 8) & 0xff;
    const ps14 = kind === 0xffff && major === 1 && (version & 0xff) === 4;
    let cursor = 1;
    while (cursor < available) {
        const token = read(cursor);
        const opcode = token & 0xffff;
        if (opcode === Op.END) {
            return Uint32Array.from({length: cursor + 1}, (_, n) => read(n));
        }
        let length: number;
        if (opcode === Op.COMMENT) length = (token >>> 16) & 0x7fff;
        else if (opcode === Op.PHASE) length = 0;
        else if (major >= 2) length = (token >>> 24) & 0xf;
        else {
            length = DEFAULT_LEN[opcode];
            if (length === undefined) throw new Error(`Unknown shader opcode ${opName(opcode)}`);
            if (ps14 && (opcode === Op.TEX || opcode === Op.TEXCOORD)) length++;
        }
        cursor += 1 + length;
    }
    throw new Error('Shader END missing or bytecode truncated');
}
