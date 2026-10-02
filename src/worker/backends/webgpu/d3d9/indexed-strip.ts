/** Expand D3D9 strips to a triangle list, preserving odd-triangle winding.
 * uint32 output also preserves 0xffff as a vertex index (not WebGPU strip restart).
 */
export function expandIndexedStrip(bytes: Uint8Array, indexBytes: 2 | 4, start: number, count: number): Uint32Array | null {
    if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 0) return null;
    if (count === 0) return new Uint32Array(0);
    if (start > Math.floor(bytes.length / indexBytes) - count - 2) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const read = (n: number) => indexBytes === 2 ? view.getUint16((start + n) * 2, true) : view.getUint32((start + n) * 4, true);
    const output = new Uint32Array(count * 3);
    for (let n = 0; n < count; n++) {
        output[n * 3] = read(n + (n & 1));
        output[n * 3 + 1] = read(n + 1 - (n & 1));
        output[n * 3 + 2] = read(n + 2);
    }
    return output;
}
