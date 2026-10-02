/** Scalar math/conversion helpers; execution and x87 state remain in WASM. */
export function aotCos(value: number): number {
    if (!Number.isFinite(value)) throw new Error('AOT FCOS nonfinite operand is unsupported');
    return Math.cos(value);
}

/** Decode the actual 80-bit little-endian memory representation to binary64. */
export function loadExtended80(memory: WebAssembly.Memory, offset: number, length: number | undefined, address: number): number {
    const view = new DataView(memory.buffer, offset, length);
    const at = address >>> 0;
    const significand = view.getBigUint64(at, true);
    const signExponent = view.getUint16(at + 8, true);
    const negative = !!(signExponent & 0x8000);
    const exponent = signExponent & 0x7fff;
    if (exponent === 0x7fff) return significand === 0x8000000000000000n ? (negative ? -Infinity : Infinity) : NaN;
    if (exponent !== 0 && !(significand & 0x8000000000000000n)) throw new Error('Unsupported unnormal x87 extended value');
    const value = (Number(significand) / 2 ** 63) * 2 ** ((exponent || 1) - 16383);
    return negative ? -value : value;
}
