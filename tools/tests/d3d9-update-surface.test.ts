import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Mem } from '../../src/worker/core/memory/mem-accessor';
import { System } from '../../src/worker/core/system';
import { createResourcesExports } from '../../src/worker/modules/d3d9/resources';
import { devices, setVTablesForTesting, resetD3D9SharedState } from '../../src/worker/modules/d3d9/shared-state';
import { surfaceMeta, clearResourceRegistry } from '../../src/worker/modules/d3d9/resource-registry';
import { d3d9ResourceLifetime } from '../../src/worker/backends/webgpu/d3d9/resource-lifetime';
import type { X86Context } from '../../src/worker/core/thunking/thunk-dispatcher';
import { D3D9Device } from '../../src/worker/backends/webgpu/d3d9/d3d9-device';

// Mock WebGPU backend for D3D9Device
class MockBackend {
    getDevice() { return null; }
    getQueue() { return null; }
    getFormat() { return 'rgba8unorm'; }
    supportsBC() { return false; }
}

describe('D3D9 UpdateSurface & OffscreenPlainSurface', () => {
    let mem: Uint8Array;
    let mockProcess: any;
    let device: D3D9Device;
    let originalSystemInstance: any;
    const devicePtr = 0x1000;

    beforeEach(() => {
        originalSystemInstance = (System as any).instance;
        mem = new Uint8Array(1024 * 1024); // 1 MB test memory
        Mem.bind(() => mem);

        let heapOffset = 0x20000;
        const allocatedBlocks = new Set<number>();

        mockProcess = {
            getCurrentMemory: () => mem,
            memory: {
                alloc: (size: number) => {
                    const ptr = heapOffset;
                    heapOffset = (heapOffset + size + 15) & ~15;
                    allocatedBlocks.add(ptr);
                    return ptr;
                },
                free: (ptr: number) => {
                    allocatedBlocks.delete(ptr);
                },
            },
        };

        (System as any).instance = {
            process: mockProcess,
            services: {
                render: {
                    setActive: () => {},
                },
            },
        };

        setVTablesForTesting({
            IDirect3DDevice9: { address: 0x4000, methods: [] } as any,
            IDirect3DTexture9: { address: 0x5000, methods: [] } as any,
            IDirect3DSurface9: { address: 0x6000, methods: [] } as any,
        });

        device = new D3D9Device(new MockBackend() as any, mem);
        devices.set(devicePtr, device);
    });

    afterEach(() => {
        (System as any).instance = originalSystemInstance;
        d3d9ResourceLifetime.clear();
        clearResourceRegistry();
        resetD3D9SharedState();
    });

    test('CreateOffscreenPlainSurface allocates guest buffer and sets metadata', () => {
        const api = createResourcesExports();
        const ctx = {} as X86Context;

        const ppSurface = 0x100;
        // width=64, height=32, format=25 (A1R5G5B5, 2 bytes/px), pool=2 (SYSTEMMEM)
        const res = api.IDirect3DDevice9_CreateOffscreenPlainSurface(ctx, mem, [
            devicePtr, 64, 32, 25, 2, ppSurface, 0,
        ]);

        expect(res).toBe(0); // D3D_OK
        const surfacePtr = Mem.readUint32(ppSurface);
        expect(surfacePtr).toBeGreaterThan(0);

        const meta = surfaceMeta.get(surfacePtr!);
        expect(meta).toBeDefined();
        expect(meta!.width).toBe(64);
        expect(meta!.height).toBe(32);
        expect(meta!.format).toBe(25);
        expect(meta!.pool).toBe(2);
        expect(meta!.guestBufferPtr).toBeGreaterThan(0);
        expect(meta!.pitch).toBe(64 * 2); // 128 bytes per row
    });

    test('LockRect on offscreen plain surface provides guest buffer and allows writing', () => {
        const api = createResourcesExports();
        const ctx = {} as X86Context;

        const ppSurface = 0x100;
        api.IDirect3DDevice9_CreateOffscreenPlainSurface(ctx, mem, [
            devicePtr, 32, 32, 21, 2, ppSurface, 0, // format 21 = A8R8G8B8 (4 bytes/px)
        ]);
        const surfacePtr = Mem.readUint32(ppSurface)!;
        const meta = surfaceMeta.get(surfacePtr)!;

        const pLockedRect = 0x200;
        const lockRes = api.IDirect3DSurface9_LockRect(ctx, mem, [surfacePtr, pLockedRect, 0, 0]);
        expect(lockRes).toBe(0);

        const pitch = Mem.readUint32(pLockedRect);
        const pBits = Mem.readUint32(pLockedRect + 4);
        expect(pitch).toBe(32 * 4);
        expect(pBits).toBe(meta.guestBufferPtr!);

        // Write pixel at (5, 5)
        const pixelOffset = pBits + 5 * pitch + 5 * 4;
        Mem.writeUint32(pixelOffset, 0x12345678);
        expect(Mem.readUint32(pixelOffset)).toBe(0x12345678);

        const unlockRes = api.IDirect3DSurface9_UnlockRect(ctx, mem, [surfacePtr]);
        expect(unlockRes).toBe(0);
    });

    test('UpdateSurface copies sub-rectangle into destination texture and marks dirty', () => {
        const api = createResourcesExports();
        const ctx = {} as X86Context;

        // 1. Create destination texture (128x128, format 21 = A8R8G8B8)
        const ppTexture = 0x100;
        api.IDirect3DDevice9_CreateTexture(ctx, mem, [
            devicePtr, 128, 128, 1, 0, 21, 0, ppTexture, 0,
        ]);
        const texPtr = Mem.readUint32(ppTexture)!;

        // Get surface level 0
        const ppDstSurface = 0x104;
        api.IDirect3DTexture9_GetSurfaceLevel(ctx, mem, [texPtr, 0, ppDstSurface]);
        const dstSurfacePtr = Mem.readUint32(ppDstSurface)!;

        // 2. Create source offscreen plain surface (16x16, format 21, SYSTEMMEM)
        const ppSrcSurface = 0x108;
        api.IDirect3DDevice9_CreateOffscreenPlainSurface(ctx, mem, [
            devicePtr, 16, 16, 21, 2, ppSrcSurface, 0,
        ]);
        const srcSurfacePtr = Mem.readUint32(ppSrcSurface)!;
        const srcMeta = surfaceMeta.get(srcSurfacePtr)!;

        // Fill source pixels: 0xCAFEBABE at row 0 col 0, 0xDEADBEEF at row 2 col 3
        const srcPitch = srcMeta.pitch!;
        Mem.writeUint32(srcMeta.guestBufferPtr!, 0xCAFEBABE);
        Mem.writeUint32(srcMeta.guestBufferPtr! + 2 * srcPitch + 3 * 4, 0xDEADBEEF);

        // 3. UpdateSurface from src (entire 16x16) to dst at point (10, 20)
        const pDestPoint = 0x300;
        Mem.writeUint32(pDestPoint + 0, 10); // x = 10
        Mem.writeUint32(pDestPoint + 4, 20); // y = 20

        const updateRes = api.IDirect3DDevice9_UpdateSurface(ctx, mem, [
            devicePtr, srcSurfacePtr, 0, dstSurfacePtr, pDestPoint,
        ]);
        expect(updateRes).toBe(0); // D3D_OK

        // 4. Verify destination texture received the pixels
        const dstTexIdx = (device as any).textures.getIndex(texPtr);
        expect((device as any).textures.isDirty(dstTexIdx)).toBe(true);

        const dstGuestPtr = (device as any).textures.getGuestPtr(dstTexIdx);
        const dstPitch = (device as any).textures.getPitch(dstTexIdx);

        // Check pixel (0, 0) of src copied to (10, 20) of dst
        const dstPixel0 = dstGuestPtr + 20 * dstPitch + 10 * 4;
        expect(Mem.readUint32(dstPixel0)).toBe(0xCAFEBABE);

        // Check pixel (3, 2) of src copied to (13, 22) of dst
        const dstPixel1 = dstGuestPtr + (20 + 2) * dstPitch + (10 + 3) * 4;
        expect(Mem.readUint32(dstPixel1)).toBe(0xDEADBEEF);

        // Check that JS texture data buffer also received the bytes
        const dstData = (device as any).textures.getData(dstTexIdx);
        const view = new DataView(dstData.buffer, dstData.byteOffset, dstData.byteLength);
        expect(view.getUint32(20 * dstPitch + 10 * 4, true)).toBe(0xCAFEBABE);
        expect(view.getUint32((20 + 2) * dstPitch + (10 + 3) * 4, true)).toBe(0xDEADBEEF);
    });

    test('Releasing offscreen plain surface cleans up surfaceMeta', () => {
        const api = createResourcesExports();
        const ctx = {} as X86Context;

        const ppSurface = 0x100;
        api.IDirect3DDevice9_CreateOffscreenPlainSurface(ctx, mem, [
            devicePtr, 16, 16, 21, 2, ppSurface, 0,
        ]);
        const surfacePtr = Mem.readUint32(ppSurface)!;

        // Refcount is 1
        expect(d3d9ResourceLifetime.count(surfacePtr)).toBe(1);

        // Release it
        const remaining = d3d9ResourceLifetime.release(surfacePtr);
        expect(remaining).toBe(0);

        // surfaceMeta is cleaned up
        expect(surfaceMeta.get(surfacePtr)).toBeUndefined();
    });
});
