import { expect, test } from 'bun:test';
import { registerCrtStringExports } from '../../src/worker/modules/crt-string';

test('wcsrchr returns the last UTF-16 code unit, including the terminator', () => {
    const exports: Record<string, any> = {};
    registerCrtStringExports(exports, {} as never);
    const text = 'C:\\WINDOWS\\msxml3.dll';
    const mem = new Uint8Array(128);
    const view = new DataView(mem.buffer);
    for (let i = 0; i < text.length; i++) view.setUint16(16 + i * 2, text.charCodeAt(i), true);
    expect(exports.wcsrchr({}, mem, [16, 92])).toBe(16 + text.lastIndexOf('\\') * 2);
    expect(exports.wcsrchr({}, mem, [16, 0])).toBe(16 + text.length * 2);
    expect(exports.wcsrchr({}, mem, [16, 63])).toBe(0);
    expect(exports.wcsrchr({}, mem, [0, 92])).toBe(0);
    expect(exports.wcsrchr({}, mem, [127, 92])).toBe(0);
});

test('wcsrchr handles non-ASCII characters without interpreting them as bytes', () => {
    const exports: Record<string, any> = {};
    registerCrtStringExports(exports, {} as never);
    const mem = new Uint8Array([0, 0, 0xa9, 3, 65, 0, 0xa9, 3, 0, 0]);
    expect(exports.wcsrchr({}, mem, [2, 0x3a9])).toBe(6);
});
