import { ThunkImplementation } from '../../core/thunking/thunk-dispatcher';
import { Mem } from '../../core/memory/mem-accessor';
import { devices, resourceToDevice, getVTables, createComObject } from './shared-state';
import { textureMeta, volumeLevels } from './resource-registry';
import { d3d9ResourceLifetime } from '../../backends/webgpu/d3d9/resource-lifetime';
import { D3D9VolumeData } from '../../backends/webgpu/d3d9/d3d9-volume';
import { isDxExclusiveFormat } from '../../backends/webgpu/shared/dx-format-support';

const INVALID = 0x8876086c;
const OOM = 0x8876017c;

export function createVolumeExports(): Record<string, ThunkImplementation> {
    const api: Record<string, ThunkImplementation> = {};
    const lod = new Map<number, number>();
    const resolve = (ptr: number, level: number) => {
        const child = volumeLevels.get(ptr);
        const texture = child?.texturePtr ?? ptr;
        return { texture, level: child?.level ?? level, volume: resourceToDevice.get(texture)?.volumeData.get(texture) };
    };
    const desc = (texture: number, volume: D3D9VolumeData | undefined, level: number, out: number) => {
        const mip = volume?.mips[level], meta = textureMeta.get(texture);
        if (!out || !mip || !meta) return INVALID;
        const values = [meta.format, 4, meta.usage, meta.pool, mip.width, mip.height, mip.depth];
        return values.every((value, i) => Mem.writeUint32(out + i * 4, value)) ? 0 : INVALID;
    };
    const lock = (ptr: number, level: number, out: number, box: number, flags: number) => {
        const found = resolve(ptr, level);
        if (!out || !found.volume) return INVALID;
        if (out + 12 > (Mem.getView()?.length ?? 0)) return INVALID;
        if (box && !Mem.readBytes(box, 24)) return INVALID;
        const bounds = box ? Array.from({ length: 6 }, (_, i) => Mem.readUint32(box + i * 4)!) : null;
        const locked = found.volume.lock(found.level, bounds, flags);
        if (!locked) return INVALID;
        const ok = Mem.writeUint32(out, locked.rowPitch) && Mem.writeUint32(out + 4, locked.slicePitch) && Mem.writeUint32(out + 8, locked.ptr);
        if (!ok) found.volume.unlock(found.level);
        return ok ? 0 : INVALID;
    };

    api.IDirect3DDevice9_CreateVolumeTexture = (_ctx, _mem, args) => {
        const [devicePtr, width, height, depth, levels, usage, format, pool, out] = args;
        if (!out || !Mem.writeUint32(out, 0)) return INVALID;
        const device = devices.get(devicePtr);
        const maxLevels = Math.floor(Math.log2(Math.max(width, height, depth))) + 1;
        const count = levels || maxLevels;
        if (!device || !width || !height || !depth || Math.max(width, height, depth) > 2048 || count > maxLevels || !format || isDxExclusiveFormat(format, 9) || pool > 3 || (usage & 3)) return INVALID;
        const vtable = getVTables().IDirect3DVolumeTexture9?.address;
        if (!vtable) return INVALID;
        const ptr = createComObject(vtable);
        if (!device.createVolumeTexture(ptr, width, height, depth, count, format)) {
            d3d9ResourceLifetime.release(ptr);
            return OOM;
        }
        resourceToDevice.set(ptr, device);
        textureMeta.set(ptr, { width, height, depth, levels: count, usage, format, pool });
        if (!Mem.writeUint32(out, ptr)) { d3d9ResourceLifetime.release(ptr); return INVALID; }
        return 0;
    };
    api.IDirect3DVolumeTexture9_GetType = () => 4;
    api.IDirect3DVolumeTexture9_GetLevelCount = (_ctx, _mem, args) => textureMeta.get(args[0])?.levels ?? 0;
    api.IDirect3DVolumeTexture9_GetLevelDesc = (_ctx, _mem, [ptr, level, out]) => desc(ptr, resolve(ptr, level).volume, level, out);
    api.IDirect3DVolumeTexture9_GetVolumeLevel = (_ctx, _mem, [ptr, level, out]) => {
        if (!out || !Mem.writeUint32(out, 0)) return INVALID;
        const found = resolve(ptr, level);
        if (!found.volume?.mips[level]) return INVALID;
        let child = [...volumeLevels].find(([, meta]) => meta.texturePtr === ptr && meta.level === level)?.[0];
        if (!child) {
            const vtable = getVTables().IDirect3DVolume9?.address;
            if (!vtable) return INVALID;
            child = createComObject(vtable);
            d3d9ResourceLifetime.alias(child, ptr);
            resourceToDevice.set(child, resourceToDevice.get(ptr)!);
            volumeLevels.set(child, { texturePtr: ptr, level });
        }
        d3d9ResourceLifetime.addRef(child);
        Mem.writeUint32(out, child);
        return 0;
    };
    api.IDirect3DVolumeTexture9_LockBox = (_ctx, _mem, [ptr, level, out, box, flags]) => lock(ptr, level, out, box, flags);
    api.IDirect3DVolumeTexture9_UnlockBox = (_ctx, _mem, [ptr, level]) => resolve(ptr, level).volume?.unlock(level) ? 0 : INVALID;
    api.IDirect3DVolume9_LockBox = (_ctx, _mem, [ptr, out, box, flags]) => lock(ptr, 0, out, box, flags);
    api.IDirect3DVolume9_UnlockBox = (_ctx, _mem, [ptr]) => {
        const found = resolve(ptr, 0);
        return found.volume?.unlock(found.level) ? 0 : INVALID;
    };
    api.IDirect3DVolume9_GetDesc = (_ctx, _mem, [ptr, out]) => {
        const found = resolve(ptr, 0);
        return desc(found.texture, found.volume, found.level, out);
    };
    api.IDirect3DVolume9_GetContainer = (_ctx, _mem, [ptr, _iid, out]) => {
        const child = volumeLevels.get(ptr);
        if (!child || !out || !Mem.writeUint32(out, child.texturePtr)) return INVALID;
        d3d9ResourceLifetime.addRef(child.texturePtr);
        return 0;
    };
    api.IDirect3DVolumeTexture9_AddDirtyBox = (_ctx, _mem, [ptr]) => {
        const volume = resolve(ptr, 0).volume;
        if (!volume) return INVALID;
        volume.dirty = true;
        return 0;
    };
    api.IDirect3DVolumeTexture9_SetLOD = (_ctx, _mem, [ptr, value]) => {
        const previous = lod.get(ptr) ?? 0;
        lod.set(ptr, Math.min(value, (textureMeta.get(ptr)?.levels ?? 1) - 1));
        return previous;
    };
    api.IDirect3DVolumeTexture9_GetLOD = (_ctx, _mem, [ptr]) => lod.get(ptr) ?? 0;
    for (const prefix of ['IDirect3DVolumeTexture9', 'IDirect3DVolume9']) {
        api[`${prefix}_GetDevice`] = (_ctx, _mem, [ptr, out]) => {
            const device = resourceToDevice.get(ptr);
            const devicePtr = [...devices].find(([, instance]) => instance === device)?.[0];
            return out && devicePtr && Mem.writeUint32(out, devicePtr) ? 0 : INVALID;
        };
    }
    api.IDirect3DVolumeTexture9_PreLoad = () => 0;
    return api;
}
