import { expect, test } from 'bun:test';
import { Shlwapi } from '../../src/worker/modules/shlwapi';
import { Mem } from '../../src/worker/core/memory/mem-accessor';
import type { Process } from '../../src/worker/core/process';
import type { X86Context } from '../../src/worker/core/thunking/thunk-dispatcher';

test('StrStrIA returns a guest pointer for the first case-insensitive match, or NULL', () => {
    const mem = new Uint8Array(1024);
    const put = (ptr: number, text: string) => { mem.fill(0, ptr, ptr + text.length + 1); mem.set(new TextEncoder().encode(text), ptr); };
    Mem.bind(() => mem);
    const module = new Shlwapi();
    module.initialize({} as Process);
    const search = (text: string, needle: string) => {
        put(64, text); put(800, needle);
        return module.exports.StrStrIA({} as X86Context, mem, [64, 800]);
    };
    expect(search('NVIDIA GeForce RTX 5070 Ti', 'amd')).toEqual({ value: 0, stackCleanup: 8 });
    expect(search('NVIDIA GeForce RTX 5070 Ti', 'ati')).toEqual({ value: 0, stackCleanup: 8 });
    expect(search('AMD Radeon AMD', 'amd')).toEqual({ value: 64, stackCleanup: 8 });
    expect(search('AMD Radeon AMD', 'RADEON')).toEqual({ value: 68, stackCleanup: 8 });
    expect(search('x'.repeat(300) + 'RaDeOn', 'radeon')).toEqual({ value: 364, stackCleanup: 8 });
    expect(search('abc', 'longer')).toEqual({ value: 0, stackCleanup: 8 });
});
