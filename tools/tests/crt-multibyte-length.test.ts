import { expect, test } from 'bun:test';
import { multibyteCharacterLength, registerCrtMbExports } from '../../src/worker/modules/crt-mb';
import { msvcrtModule } from '../../src/worker/api/msvcrt.api';

test('_mbstrlen counts characters, validates multibyte sequences and preserves the C locale', () => {
    expect(multibyteCharacterLength(new TextEncoder().encode('main'), 0)).toBe(4);
    expect(multibyteCharacterLength(Uint8Array.of(0xff, 0x80), 0)).toBe(2);
    expect(multibyteCharacterLength(new TextEncoder().encode('Aé😀'), 65001)).toBe(3);
    expect(multibyteCharacterLength(Uint8Array.of(0x82, 0xa0, 0x41), 932)).toBe(2);
    expect(multibyteCharacterLength(Uint8Array.of(0x82), 932)).toBe(0xffffffff);
    expect(multibyteCharacterLength(Uint8Array.of(0xc0, 0xaf), 65001)).toBe(0xffffffff);
    const abi = msvcrtModule.functions.find(f => f.name === '_mbstrlen');
    expect(abi?.params.length).toBe(1);
    expect(abi?.callingConvention).toBe('cdecl');
});

test('_mbstrlen sets errno on invalid input and excludes the null terminator', () => {
    const exports: any = {};
    let errno = 0, invalid = 0;
    registerCrtMbExports(exports, {
        readCString: () => '', compareCString: () => 0, ischartype: () => 0, setMbcp: () => 0,
        localeCodePage: () => 65001, setErrno: n => { errno = n; }, invalidParameter: () => { invalid++; },
    });
    const mem = Uint8Array.of(0, 65, 66, 0, 0xc0, 0xaf, 0);
    expect(exports._mbstrlen({}, mem, [1])).toBe(2);
    expect(exports._mbstrlen({}, mem, [4])).toBe(0xffffffff);
    expect(errno).toBe(42);
    expect(exports._mbstrlen({}, mem, [0])).toBe(0xffffffff);
    expect(errno).toBe(22);
    expect(invalid).toBe(1);
});
