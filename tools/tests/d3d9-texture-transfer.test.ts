import { expect, test } from 'bun:test';
import { textureUpdateLevelOffset } from '../../src/worker/modules/d3d9/texture-transfer';
import { D3D9Device } from '../../src/worker/backends/webgpu/d3d9/d3d9-device';
import { D3D9VolumeData } from '../../src/worker/backends/webgpu/d3d9/d3d9-volume';
import { writeDeviceCaps9 } from '../../src/worker/modules/d3d9/caps';
import { createDeviceExports } from '../../src/worker/modules/d3d9/device';
import { createStateExports } from '../../src/worker/modules/d3d9/state';
import { devices } from '../../src/worker/modules/d3d9/shared-state';
import { d3d9ResourceLifetime } from '../../src/worker/backends/webgpu/d3d9/resource-lifetime';
import { Mem } from '../../src/worker/core/memory/mem-accessor';
import { validCopyRect } from '../../src/worker/backends/webgpu/d3d9/stretch-rect';

test('surface copy rectangles reject signed-negative, empty and out-of-bounds regions', () => {
    expect(validCopyRect([0, 0, 800, 600], 800, 600)).toBe(true);
    expect(validCopyRect([12, 20, 50, 60], 800, 600)).toBe(true);
    for (const rect of [[-1, 0, 10, 10], [0xffffffff, 0, 10, 10], [1, 1, 1, 3], [0, 0, 801, 600], [0, 0, 800, 601]]) {
        expect(validCopyRect(rect as [number, number, number, number], 800, 600)).toBe(false);
    }
});

test('UpdateTexture matches mip-chain tails and rejects incompatible pools, formats, types or sizes', () => {
    const source = { width: 32, height: 16, levels: 6, format: 21, pool: 2, usage: 0 };
    const target = { ...source, width: 4, height: 2, levels: 3, pool: 0 };
    expect(textureUpdateLevelOffset(source, target)).toBe(3);
    for (const patch of [{ pool: 1 }, { format: 22 }, { width: 8 }, { levels: 7 }, { isCube: true }, { depth: 4 }, { usage: 0x400 }]) {
        expect(textureUpdateLevelOffset(source, { ...target, ...patch })).toBeNull();
    }
    expect(textureUpdateLevelOffset({ ...source, pool: 0 }, target)).toBeNull();
});

test('native texture transfer copies each selected level after submitting old draws', () => {
    const device = Object.create(D3D9Device.prototype) as any;
    const order: string[] = [];
    device.textures = { getIndex: (ptr: number) => ptr, isCubeMap: () => false, setDirty: () => order.push('dirty') };
    device.volumeData = new Map();
    device.submitFrame = () => order.push('submit');
    device.getTextureLevelPixels = (_ptr: number, level: number) => ({ data: new Uint8Array([level, level + 1]), pitch: 2 });
    const copies: number[][] = [];
    device.setTextureLevelPixels = (_ptr: number, level: number, data: Uint8Array, pitch: number) => {
        order.push('copy'); copies.push([level, ...data, pitch]); return true;
    };
    expect(device.copyTextureLevels(10, 20, 3, 2)).toBe(true);
    expect(order).toEqual(['submit', 'copy', 'copy', 'dirty']);
    expect(copies).toEqual([[0, 3, 4, 2], [1, 4, 5, 2]]);
});

test('volume transfer copies all slices including lower mips into independent backing', () => {
    const device = Object.create(D3D9Device.prototype) as any;
    device.textures = { getIndex: (ptr: number) => ptr, setDirty: () => {} };
    device.submitFrame = () => {};
    device.memory = new Uint8Array(1024);
    const source = new D3D9VolumeData(0, 4, 4, 4, 3, 21);
    const target = new D3D9VolumeData(600, 2, 2, 2, 2, 21);
    device.volumeData = new Map([[10, source], [20, target]]);
    device.memory.fill(71, source.mips[1].offset, source.mips[1].offset + source.mips[1].bytes);
    device.memory.fill(92, source.mips[2].offset, source.mips[2].offset + source.mips[2].bytes);
    expect(device.copyTextureLevels(10, 20, 1, 2)).toBe(true);
    expect([...device.memory.subarray(600, 632)]).toEqual(new Array(32).fill(71));
    expect([...device.memory.subarray(632, 636)]).toEqual(new Array(4).fill(92));
    expect(target.dirty).toBe(true);
});

test('GetTexture acquires a caller reference, and returns NULL for an empty stage', () => {
    const memory = new Uint8Array(256); Mem.bind(() => memory);
    const view = new DataView(memory.buffer);
    devices.set(11, { getBoundTexturePtr: (stage: number) => stage === 0 ? 22 : 0 } as never);
    let destroyed = false;
    d3d9ResourceLifetime.register(22, () => { destroyed = true; });
    try {
        const get = createStateExports().IDirect3DDevice9_GetTexture;
        expect(get({} as never, memory, [11, 0, 64])).toBe(0);
        expect(view.getUint32(64, true)).toBe(22);
        expect(d3d9ResourceLifetime.release(22)).toBe(1);
        expect(destroyed).toBe(false);
        expect(get({} as never, memory, [11, 1, 64])).toBe(0);
        expect(view.getUint32(64, true)).toBe(0);
        expect(get({} as never, memory, [11, 99, 64])).toBe(0x8876086c);
    } finally { devices.delete(11); d3d9ResourceLifetime.release(22); }
});

test('shader constant queries preserve native float bits and reject overflowing register ranges', () => {
    const memory = new Uint8Array(256); Mem.bind(() => memory);
    const device = Object.create(D3D9Device.prototype) as any;
    device.psConstantBits = new Uint32Array([0x3f800000, 0x80000000, 0x7fc01234, 0x40400000, 5, 6, 7, 8]);
    device.vsConstantBits = new Uint32Array(16);
    expect(device.readShaderConstants(false, 0, 1, 64)).toBe(true);
    expect([...new Uint32Array(memory.buffer, 64, 4)]).toEqual([0x3f800000, 0x80000000, 0x7fc01234, 0x40400000]);
    expect(device.readShaderConstants(false, 1, 2, 64)).toBe(false);
    expect(device.readShaderConstants(false, 0xffffffff, 1, 64)).toBe(false);
});


test('extra D3D9 vertex streams retain independent offsets, uploads and bindings', () => {
    const device = Object.create(D3D9Device.prototype) as any;
    device.extraVertexStreams = new Map();
    const bindingChanges: [string, number][] = [];
    const uploads: number[] = [];
    const buffers = new Map();
    device.vertexBuffers = {
        getIndex: (ptr: number) => ptr === 0 ? null : ptr,
        getData: () => new Uint8Array(128), getSize: () => 128,
        getGpuBuffer: (index: number) => buffers.get(index),
        setGpuBuffer: (index: number, buffer: object) => buffers.set(index, buffer),
        isDirty: () => true, setDirty: () => {},
    };
    device.resourceBindings = {set: (name: string, ptr: number) => bindingChanges.push([name, ptr])};
    device.vsDeclRegistry = new Map([[4, [{stream: 1}, {stream: 1}, {stream: 3}]]]);
    device.activeVertexDecl = 4;
    device.backend = {getDevice: () => ({createBuffer: (descriptor: object) => descriptor})};
    device.commandRecorder = {queueUpload: (_buffer: object, data: Uint8Array) => uploads.push(data.length)};
    const oldUsage = (globalThis as any).GPUBufferUsage;
    (globalThis as any).GPUBufferUsage = {VERTEX: 32, COPY_DST: 8};
    try {
        expect(device.setStreamSource(1, 11, 16, 16)).toBe(0);
        expect(device.setStreamSource(3, 33, 32, 24)).toBe(0);
        expect(device._lrValid).toBe(false);
        expect(device.prepareExtraVertexStreams().map(({slot, offset, size}: any) => [slot, offset, size]))
            .toEqual([[1, 16, 112], [3, 32, 96]]);
        expect(uploads).toEqual([128, 128]);
        expect(device.setStreamSource(1, 0, 0, 0)).toBe(0);
        expect(bindingChanges.at(-1)).toEqual(['stream1', 0]);
        expect(device.extraVertexStreams.has(1)).toBe(false);
        expect(device.setStreamSource(16, 33, 0, 24)).toBe(0x8876086c);
    } finally { (globalThis as any).GPUBufferUsage = oldUsage; }
});


test('GetRenderTarget preserves the real surface and acquires a caller reference', () => {
    const memory = new Uint8Array(256); Mem.bind(() => memory);
    devices.set(12, {getRenderTargetSurface: (index: number) => index === 0 ? 44 : 0} as never);
    d3d9ResourceLifetime.register(44, () => {});
    try {
        const get = createDeviceExports().IDirect3DDevice9_GetRenderTarget;
        expect(get({} as never, memory, [12, 0, 64])).toBe(0);
        expect(Mem.readUint32(64)).toBe(44);
        expect(d3d9ResourceLifetime.count(44)).toBe(2);
        expect(get({} as never, memory, [12, 1, 64])).toBe(0x88760866);
        expect(Mem.readUint32(64)).toBe(0);
    } finally { devices.delete(12); d3d9ResourceLifetime.release(44); d3d9ResourceLifetime.release(44); }
});

test('clearing a secondary render target leaves the primary target unchanged', () => {
    const device = Object.create(D3D9Device.prototype) as any;
    device.currentRtIndex = 21;
    device.currentRtFace = -1;
    device.primaryRenderSurface = 44;
    device.secondaryRtIndex = null;
    device.textures = {getIndex: () => 22, isRenderTarget: () => true};
    const refs: string[] = [];
    device.submitFrame = () => refs.push('submit');
    device.resourceBindings = {set: (slot: string) => refs.push(slot)};
    expect(device.setRenderTarget(1, 0)).toBe(0);
    expect(device.currentRtIndex).toBe(21);
    expect(device.primaryRenderSurface).toBe(44);
    expect(device.setRenderTarget(1, 123, -1, 124)).toBe(0);
    expect(device.secondaryRtIndex).toBe(22);
    expect(device.getRenderTargetSurface(1)).toBe(124);
    expect(device.currentRtIndex).toBe(21);
    expect(refs).toEqual(['submit', 'renderTarget1', 'renderSurface1']);
});


test('GetBackBuffer reuses the swap chain surface and adds a separate caller reference', () => {
    const memory = new Uint8Array(256); Mem.bind(() => memory);
    devices.set(13, {getImplicitBackBufferSurface: () => 55} as never);
    d3d9ResourceLifetime.register(55, () => {});
    try {
        const get = createDeviceExports().IDirect3DDevice9_GetBackBuffer;
        expect(get({} as never, memory, [13, 0, 0, 0, 64])).toBe(0);
        expect(Mem.readUint32(64)).toBe(55);
        expect(d3d9ResourceLifetime.release(55)).toBe(1);
        expect(get({} as never, memory, [13, 0, 0, 0, 68])).toBe(0);
        expect(Mem.readUint32(68)).toBe(55);
        expect(d3d9ResourceLifetime.release(55)).toBe(1);
    } finally { devices.delete(13); d3d9ResourceLifetime.release(55); }
});


test('D3D9 caps advertise the two implemented programmable color attachments', () => {
    const memory = new Uint8Array(512); Mem.bind(() => memory);
    expect(writeDeviceCaps9(64)).toBe(true);
    expect(Mem.readUint32(64 + 240)).toBe(2);
});
