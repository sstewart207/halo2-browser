import { expect, test } from 'bun:test';
import { readDelayImport } from '../../src/worker/modules/kernel32/delay-import';

function fixture(rva: boolean) {
    const memory = new Uint8Array(0x4000);
    const view = new DataView(memory.buffer);
    const base = 0x1000, descriptor = base + 0x100, iat = base + 0x400;
    const encoded = (offset: number) => offset + (rva ? 0 : base);
    [rva ? 1 : 0, encoded(0x200), encoded(0x300), encoded(0x400), encoded(0x500), 0, 0, 0]
        .forEach((value, index) => view.setUint32(descriptor + index * 4, value, true));
    view.setUint32(base + 0x500, encoded(0x600), true);
    view.setUint32(base + 0x504, 0x80000007, true);
    return { memory, view, base, descriptor, iat };
}

test('PE32 delay imports resolve named and ordinal slots with RVA and legacy VA descriptors', () => {
    for (const rva of [true, false]) {
        const { memory, base, descriptor, iat } = fixture(rva);
        expect(readDelayImport(memory, base, descriptor, iat)).toEqual({
            dllNameAddress: base + 0x200, moduleHandleAddress: base + 0x300,
            procedureAddressOrOrdinal: base + 0x602, byName: true,
        });
        expect(readDelayImport(memory, base, descriptor, iat + 4)).toEqual({
            dllNameAddress: base + 0x200, moduleHandleAddress: base + 0x300,
            procedureAddressOrOrdinal: 7, byName: false,
        });
    }
});

test('delay imports reject invalid descriptor pointers, attributes and slots beyond terminator', () => {
    const { memory, view, base, descriptor, iat } = fixture(true);
    expect(readDelayImport(memory, base, memory.length - 16, iat)).toBeNull();
    expect(readDelayImport(memory, base, descriptor, iat - 4)).toBeNull();
    expect(readDelayImport(memory, base, descriptor, iat + 1)).toBeNull();
    expect(readDelayImport(memory, base, descriptor, iat + 8)).toBeNull();
    expect(readDelayImport(memory, base, descriptor, iat + 12)).toBeNull();
    view.setUint32(descriptor, 3, true);
    expect(readDelayImport(memory, base, descriptor, iat)).toBeNull();
});
