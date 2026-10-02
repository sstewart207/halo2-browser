import { expect, test } from 'bun:test';
import { IDirect3D9, IDirect3D9Ex, IDirect3DDevice9, IDirect3DDevice9Ex, d3d9Module } from '../../src/worker/api/d3d9.api';
import { generateVTableSpec } from '../../src/worker/api/codegen';
import { createFactoryExports } from '../../src/worker/modules/d3d9/factory';
import { Mem } from '../../src/worker/core/memory/mem-accessor';
import type { X86Context } from '../../src/worker/core/thunking/thunk-dispatcher';

test('D3D9Ex preserves inherited ABI and appends the SDK extension slots', () => {
    expect(IDirect3D9.methods.length).toBe(17);
    expect(IDirect3DDevice9.methods.length).toBe(119);
    for (const [base, ex] of [[IDirect3D9, IDirect3D9Ex], [IDirect3DDevice9, IDirect3DDevice9Ex]]) {
        expect(ex.methods.slice(0, base.methods.length)).toEqual(base.methods);
    }
    const factory = generateVTableSpec(IDirect3D9Ex);
    expect(factory.methods[20]).toEqual({ name: 'IDirect3D9Ex_CreateDeviceEx', argCount: 8, stackCleanup: 32 });
    const device = generateVTableSpec(IDirect3DDevice9Ex);
    expect(device.methods[121]).toEqual({ name: 'IDirect3DDevice9Ex_PresentEx', argCount: 6, stackCleanup: 24 });
    expect(device.methods[132].name).toBe('IDirect3DDevice9Ex_ResetEx');
    expect(device.methods.length).toBe(134);
    expect(d3d9Module.functions.find(f => f.name === 'Direct3DCreate9Ex')?.params.length).toBe(2);
});

test('Ex mode enumeration writes the extended structure and rejects invalid filters', () => {
    const mem = new Uint8Array(1024);
    Mem.bind(() => mem);
    const view = new DataView(mem.buffer);
    const api = createFactoryExports();
    const ctx = {} as X86Context;
    view.setUint32(64, 12, true); // filter Size
    view.setUint32(68, 22, true); // X8R8G8B8
    view.setUint32(72, 1, true); // progressive
    const count = api.IDirect3D9Ex_GetAdapterModeCountEx(ctx, mem, [0, 0, 64]);
    expect(typeof count).toBe('number');
    expect(count as number).toBeGreaterThan(0);
    view.setUint32(128, 24, true);
    expect(api.IDirect3D9Ex_EnumAdapterModesEx(ctx, mem, [0, 0, 64, 0, 128])).toBe(0);
    expect(view.getUint32(132, true)).toBeGreaterThanOrEqual(640);
    expect(view.getUint32(136, true)).toBeGreaterThanOrEqual(480);
    expect(view.getUint32(144, true)).toBe(22);
    expect(view.getUint32(148, true)).toBe(1);
    view.setUint32(64, 0, true);
    expect(api.IDirect3D9Ex_GetAdapterModeCountEx(ctx, mem, [0, 0, 64])).toBe(0);
    expect(api.IDirect3D9Ex_EnumAdapterModesEx(ctx, mem, [0, 0, 64, 0, 128])).toBe(0x8876086c);
    view.setUint32(200, 0xdeadbeef, true);
    expect(api.Direct3DCreate9Ex(ctx, mem, [0, 200])).toBe(0x8876086a);
    expect(view.getUint32(200, true)).toBe(0);
});
