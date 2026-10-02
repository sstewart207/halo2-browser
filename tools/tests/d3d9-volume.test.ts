import { afterEach, expect, test } from 'bun:test';
import { D3D9VolumeData, volumeMipLayouts } from '../../src/worker/backends/webgpu/d3d9/d3d9-volume';
import { createVolumeExports } from '../../src/worker/modules/d3d9/volume-resources';
import { Mem } from '../../src/worker/core/memory/mem-accessor';
import { resourceToDevice } from '../../src/worker/modules/d3d9/shared-state';
import { textureMeta, clearResourceRegistry } from '../../src/worker/modules/d3d9/resource-registry';
import { IDirect3DVolumeTexture9, IDirect3DVolume9, IDirect3DDevice9 } from '../../src/worker/api/d3d9.api';
import { compileVertexShader, compilePixelShader, linkProgram } from '../../src/worker/backends/webgpu/d3d9/shader';

afterEach(() => { clearResourceRegistry(); resourceToDevice.clear(); });

test('volume mip pitches include every depth slice and clamp each dimension independently', () => {
    const mips = volumeMipLayouts(8, 4, 2, 4, 21);
    expect(mips.map(m => [m.width, m.height, m.depth, m.rowPitch, m.slicePitch, m.offset, m.bytes])).toEqual([
        [8, 4, 2, 32, 128, 0, 256], [4, 2, 1, 16, 32, 256, 32], [2, 1, 1, 8, 8, 288, 8], [1, 1, 1, 4, 4, 296, 4],
    ]);
});

test('box locks preserve row/slice pitches, reject invalid and duplicate locks, and respect readonly', () => {
    const volume = new D3D9VolumeData(128, 8, 4, 2, 4, 21);
    expect(volume.lock(0, [2, 1, 5, 3, 1, 2], 0)).toEqual({ ptr: 296, rowPitch: 32, slicePitch: 128 });
    expect(volume.lock(0, null, 0)).toBeNull();
    expect(volume.unlock(0)).toBe(true);
    expect(volume.unlock(0)).toBe(false);
    expect(volume.lock(4, null, 0)).toBeNull();
    expect(volume.lock(0, [0, 0, 9, 4, 0, 2], 0)).toBeNull();
    volume.dirty = false;
    expect(volume.lock(1, null, 0x10)).not.toBeNull();
    volume.unlock(1);
    expect(volume.dirty).toBe(false);
});

test('compressed volume boxes use block rows rather than pixel rows', () => {
    const volume = new D3D9VolumeData(128, 8, 8, 2, 1, 0x31545844);
    expect(volume.lock(0, [4, 4, 8, 8, 1, 2], 0)).toEqual({ ptr: 184, rowPitch: 16, slicePitch: 32 });
    volume.unlock(0);
    expect(volume.lock(0, [1, 0, 4, 4, 0, 1], 0)).toBeNull();
});

test('native pixels from distinct depth slices reach the 3D GPU upload in order', () => {
    const volume = new D3D9VolumeData(128, 1, 1, 2, 1, 21);
    const memory = new Uint8Array(256);
    memory.set([30, 20, 10, 255, 60, 50, 40, 255], 128);
    expect([...volume.rgba(0, memory)]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
});

test('volume HLE writes the native locked-box and descriptor layouts', () => {
    const memory = new Uint8Array(1024); Mem.bind(() => memory);
    const volume = new D3D9VolumeData(512, 4, 4, 4, 3, 21);
    resourceToDevice.set(64, { volumeData: new Map([[64, volume]]) } as any);
    textureMeta.set(64, { width: 4, height: 4, depth: 4, levels: 3, usage: 0, format: 21, pool: 1 });
    const api = createVolumeExports(), ctx = {} as any, view = new DataView(memory.buffer);
    expect(api.IDirect3DVolumeTexture9_LockBox(ctx, memory, [64, 0, 128, 0, 0])).toBe(0);
    expect([0, 4, 8].map(n => view.getUint32(128 + n, true))).toEqual([16, 64, 512]);
    expect(api.IDirect3DVolumeTexture9_UnlockBox(ctx, memory, [64, 0])).toBe(0);
    expect(api.IDirect3DVolumeTexture9_GetLevelDesc(ctx, memory, [64, 1, 160])).toBe(0);
    expect(Array.from({ length: 7 }, (_, n) => view.getUint32(160 + n * 4, true))).toEqual([21, 4, 0, 1, 2, 2, 2]);
});

test('volume COM ABI has the native slots and stack argument counts', () => {
    expect(IDirect3DVolumeTexture9.methods[18].name).toBe('GetVolumeLevel');
    expect(IDirect3DVolumeTexture9.methods[19].params.length).toBe(5);
    expect(IDirect3DVolume9.methods[9].name).toBe('LockBox');
    expect(IDirect3DVolume9.methods[9].params.length).toBe(4);
    expect(IDirect3DDevice9.methods.find(m => m.name === 'CreateVolumeTexture')!.params.length).toBe(10);
});

test('volume sampler declarations and coordinates agree in linked WGSL', () => {
    const vs = compileVertexShader(new Uint32Array([0xfffe0101, 1, 0x400f0000, 0x00e40000, 0xffff]));
    const ps = compilePixelShader(new Uint32Array([0xffff0200, 0x0200001f, 0x20000000, 0x200f0800,
        0x03000042, 0x000f0000, 0x30e40000, 0x20e40800, 0xffff]));
    const link = linkProgram({ vs, ps, declElements: null, streamStride: 16 });
    expect(link.cubeMask).toBe(256);
    expect(link.wgsl).toContain('texture_3d<f32>');
    expect(link.wgsl).toMatch(/textureSample\(tex0, samp, .*\.xyz\)/);
});
