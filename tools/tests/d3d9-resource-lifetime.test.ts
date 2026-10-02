import { afterEach, expect, test } from 'bun:test';
import { ResourceLifetime, ResourceBindings, d3d9ResourceLifetime } from '../../src/worker/backends/webgpu/d3d9/resource-lifetime';
import { createStateExports } from '../../src/worker/modules/d3d9/state';
import { registerFastPathD3D9Functions } from '../../src/worker/modules/d3d9/fast-path';
import { Mem } from '../../src/worker/core/memory/mem-accessor';
import { createResourcesExports } from '../../src/worker/modules/d3d9/resources';
import { textureMeta, textureLevelSurfaces, clearResourceRegistry } from '../../src/worker/modules/d3d9/resource-registry';
import { retainStateBlockTextures, type D3D9StateBlockData } from '../../src/worker/backends/webgpu/d3d9/d3d9-state-block';
import type { X86Context } from '../../src/worker/core/thunking/thunk-dispatcher';

afterEach(() => { d3d9ResourceLifetime.clear(); clearResourceRegistry(); });

test('state-block capture holds texture references and releases the previous capture', () => {
    const destroyed: number[] = [];
    d3d9ResourceLifetime.register(64, () => destroyed.push(64));
    d3d9ResourceLifetime.register(72, () => destroyed.push(72));
    const block: D3D9StateBlockData = { devicePtr: 0, blockType: 1, entries: [{ op: 'texture', stage: 0, texPtr: 64 }] };
    retainStateBlockTextures(block);
    d3d9ResourceLifetime.release(64);
    expect(destroyed).toEqual([]);
    block.entries = [{ op: 'texture', stage: 0, texPtr: 72 }];
    retainStateBlockTextures(block);
    expect(destroyed).toEqual([64]);
    d3d9ResourceLifetime.release(72);
    block.resourceRefs!.clear();
    expect(destroyed).toEqual([64, 72]);
});

test('GetSurfaceLevel acquires a reference even when it returns a cached surface', () => {
    const mem = new Uint8Array(256);
    Mem.bind(() => mem);
    d3d9ResourceLifetime.register(64, () => {});
    d3d9ResourceLifetime.alias(68, 64);
    textureMeta.set(64, { width: 800, height: 600, levels: 1, usage: 1, format: 21, pool: 0 });
    textureLevelSurfaces.set(64, new Map([[0, 68]]));
    const api = createResourcesExports();
    const ctx = {} as X86Context;
    expect(api.IDirect3DTexture9_GetSurfaceLevel(ctx, mem, [64, 0, 128])).toBe(0);
    expect(api.IDirect3DTexture9_GetSurfaceLevel(ctx, mem, [64, 0, 132])).toBe(0);
    expect(new DataView(mem.buffer).getUint32(128, true)).toBe(68);
    expect(d3d9ResourceLifetime.count(64)).toBe(3);
    d3d9ResourceLifetime.release(68);
    d3d9ResourceLifetime.release(68);
    expect(d3d9ResourceLifetime.count(64)).toBe(1);
});

test('repeated render-target creation/disposal releases backing exactly once per resource', () => {
    const refs = new ResourceLifetime();
    let liveBytes = 0;
    let destroys = 0;
    for (let iteration = 0; iteration < 200; iteration++) {
        const texture = 100 + iteration * 8;
        const surface = texture + 4;
        liveBytes += 800 * 600 * 4;
        refs.register(texture, () => { liveBytes -= 800 * 600 * 4; destroys++; });
        refs.alias(surface, texture);
        refs.addRef(surface); // GetSurfaceLevel
        refs.release(texture);
        expect(liveBytes).toBe(800 * 600 * 4); // Surface still owns its parent.
        expect(refs.release(surface)).toBe(0);
        expect(refs.release(surface)).toBe(0); // No double destruction.
        expect(liveBytes).toBe(0);
    }
    expect(destroys).toBe(200);
});

test('multiple surfaces and device bindings keep a texture alive until the last owner releases', () => {
    const refs = new ResourceLifetime();
    const bindings = new ResourceBindings(refs);
    let destroyed = 0;
    refs.register(100, () => destroyed++);
    refs.alias(104, 100);
    refs.alias(108, 100);
    refs.addRef(104);
    refs.addRef(108);
    bindings.set('texture:0', 100);
    bindings.set('renderTarget', 104);
    bindings.set('renderTarget', 104); // Rebinding does not leak a reference.
    expect(refs.count(100)).toBe(5);
    refs.release(100);
    refs.release(104);
    refs.release(108);
    expect(destroyed).toBe(0);
    bindings.set('texture:0', 0);
    expect(destroyed).toBe(0);
    bindings.clear();
    expect(destroyed).toBe(1);
});

test('slow QueryInterface/AddRef/Release preserve ownership and return changing counts', () => {
    const api = createStateExports();
    const mem = new Uint8Array(256);
    Mem.bind(() => mem);
    const ctx = {} as X86Context;
    let destroyed = 0;
    d3d9ResourceLifetime.register(64, () => destroyed++);
    expect(api.IDirect3DTexture9_QueryInterface(ctx, mem, [64, 0, 128])).toBe(0);
    expect(new DataView(mem.buffer).getUint32(128, true)).toBe(64);
    expect(api.IDirect3DTexture9_AddRef(ctx, mem, [64])).toBe(3);
    expect(api.IDirect3DTexture9_Release(ctx, mem, [64])).toBe(2);
    expect(api.IDirect3DTexture9_Release(ctx, mem, [64])).toBe(1);
    expect(api.IDirect3DTexture9_Release(ctx, mem, [64])).toBe(0);
    expect(destroyed).toBe(1);
});

test('fast resource releases execute cleanup and cannot be replaced by constant stubs', () => {
    const paths = new Map<string, Function>();
    const constants: string[] = [];
    const dispatcher = new Proxy({}, { get: (_target, key) => {
        if (key === 'registerFastPath') return (_dll: string, name: string, fn: Function) => paths.set(name, fn);
        if (key === 'registerConstantReturnStub') return (_dll: string, name: string) => constants.push(name);
        return () => {};
    }});
    registerFastPathD3D9Functions(dispatcher);
    let destroyed = 0;
    d3d9ResourceLifetime.register(64, () => destroyed++);
    const mem = new Uint8Array(256);
    const view = new DataView(mem.buffer);
    const cpu = { reg32: [0, 0, 0, 0, 128] };
    view.setUint32(132, 64, true);
    expect(paths.get('IDirect3DTexture9_AddRef')!(cpu, mem, new Uint32Array(mem.buffer), view)).toBe(2);
    expect(paths.get('IDirect3DTexture9_Release')!(cpu, mem, new Uint32Array(mem.buffer), view)).toBe(1);
    expect(paths.get('IDirect3DTexture9_Release')!(cpu, mem, new Uint32Array(mem.buffer), view)).toBe(0);
    expect(destroyed).toBe(1);
    expect(constants.filter(name => /_(AddRef|Release)$/.test(name))).toEqual([]);
});
