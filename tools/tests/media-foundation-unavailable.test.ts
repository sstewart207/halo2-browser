import { expect, test } from 'bun:test';
import { MediaFoundation, E_NOTIMPL, E_POINTER } from '../../src/worker/modules/media-foundation';
import { Mem } from '../../src/worker/core/memory/mem-accessor';
import { win32ImportSupplements } from '../../src/worker/api/win32-import-supplement';

test('unavailable Media Foundation uses failing HRESULTs, never successful Win32 error 50', () => {
    const module = new MediaFoundation('mfplat');
    module.initialize({} as never);
    const memory = new Uint8Array(256);
    expect(module.exports.MFStartup({} as never, memory, [0x10070, 0]))
        .toEqual({ value: E_NOTIMPL, stackCleanup: 8 });
    expect(E_NOTIMPL | 0).toBeLessThan(0);
    expect(module.exports.MFShutdown({} as never, memory, []))
        .toEqual({ value: E_NOTIMPL, stackCleanup: 0 });
});

test('unavailable factories clear stale COM outputs and preserve stdcall ABI', () => {
    const module = new MediaFoundation('mf');
    module.initialize({} as never);
    const memory = new Uint8Array(256);
    Mem.bind(() => memory);
    const view = new DataView(memory.buffer);
    const abi = win32ImportSupplements.find(m => m.name === 'mf')!;
    for (const descriptor of abi.functions) {
        const args = new Array(descriptor.params.length).fill(0);
        args[args.length - 1] = 64;
        view.setUint32(64, 0xdeadbeef, true);
        expect(module.exports[descriptor.name]({} as never, memory, args))
            .toEqual({ value: E_NOTIMPL, stackCleanup: args.length * 4 });
        expect(view.getUint32(64, true)).toBe(0);
        args[args.length - 1] = 0;
        expect(module.exports[descriptor.name]({} as never, memory, args))
            .toEqual({ value: E_POINTER, stackCleanup: args.length * 4 });
    }
});
