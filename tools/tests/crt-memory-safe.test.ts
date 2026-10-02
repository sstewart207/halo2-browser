import { expect, test } from 'bun:test';
import { memcpySafe } from '../../src/worker/modules/crt-memory-safe';

function fixture() {
    const memory = new Uint8Array(64).fill(0xcc);
    memory.set([1, 2, 3, 4], 32);
    const errors: number[] = [];
    const host = {
        copy: (destination: number, source: number, count: number) => memory.set(memory.subarray(source, source + count), destination),
        clear: (destination: number, size: number) => memory.fill(0, destination, destination + size),
        invalidParameter: (code: number) => { errors.push(code); },
    };
    return { memory, errors, host };
}

test('memcpy_s copies count bytes and preserves the unused destination', () => {
    const { memory, errors, host } = fixture();
    expect(memcpySafe(host, 8, 8, 32, 4)).toBe(0);
    expect([...memory.subarray(8, 17)]).toEqual([1, 2, 3, 4, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc]);
    expect(errors).toEqual([]);
});

test('memcpy_s clears only destination capacity on short buffer or null source', () => {
    for (const [source, size, expected] of [[32, 3, 34], [0, 8, 22]]) {
        const { memory, errors, host } = fixture();
        expect(memcpySafe(host, 8, size, source, 4)).toBe(expected);
        expect([...memory.subarray(8, 8 + size)]).toEqual(Array(size).fill(0));
        expect(memory[7]).toBe(0xcc);
        expect(memory[8 + size]).toBe(0xcc);
        expect(errors).toEqual([expected]);
    }
});

test('memcpy_s allows zero-count null pointers and rejects nonzero null destination', () => {
    const { memory, errors, host } = fixture();
    const before = memory.slice();
    expect(memcpySafe(host, 0, 0, 0, 0)).toBe(0);
    expect(errors).toEqual([]);
    expect(memcpySafe(host, 0, 8, 32, 4)).toBe(22);
    expect(memory).toEqual(before);
    expect(errors).toEqual([22]);
});
