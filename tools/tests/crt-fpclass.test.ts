import { expect, test } from 'bun:test';
import { classifyCrtDouble } from '../../src/worker/modules/crt-math';
import { msvcrtModule } from '../../src/worker/api/msvcrt.api';

test('_fpclass distinguishes all ten IEEE-754 classes, including signed zero and signaling NaN', () => {
    for (const [lo, hi, flag] of [
        [1, 0x7ff00000, 1], [1, 0x7ff80000, 2], [0, 0xfff00000, 4],
        [0, 0xbff00000, 8], [1, 0x80000000, 16], [0, 0x80000000, 32],
        [0, 0, 64], [1, 0, 128], [0, 0x3ff00000, 256], [0, 0x7ff00000, 512],
    ]) expect(classifyCrtDouble(lo, hi)).toBe(flag);
});

test('native D3DX math helpers retain the cdecl x87 calling convention', () => {
    for (const name of ['_CIcosh', '_CIsinh', '_CItanh']) {
        const descriptor = msvcrtModule.functions.find(f => f.name === name)!;
        expect(descriptor.callingConvention).toBe('cdecl');
        expect(descriptor.params.length).toBe(0);
    }
    expect(msvcrtModule.functions.find(f => f.name === '_fpclass')?.params.length).toBe(2);
});
