import type { ThunkImplementation } from '../../core/thunking/thunk-dispatcher';
import { Mem } from '../../core/memory/mem-accessor';
import { devices, resourceToDevice } from './shared-state';
import { textureMeta, surfaceMeta, type TextureMeta } from './resource-registry';
import { validCopyRect, type CopyRect } from '../../backends/webgpu/d3d9/stretch-rect';

/** UpdateTexture matches the tails of mip chains, not necessarily their top levels.
 * Full-level copying is legal even when only part of the source is dirty.
 * https://learn.microsoft.com/en-us/windows/win32/api/d3d9/nf-d3d9-idirect3ddevice9-updatetexture
 */
export function textureUpdateLevelOffset(source: TextureMeta, target: TextureMeta): number | null {
    if (source.pool !== 2 || target.pool !== 0 || source.format !== target.format ||
        !!source.isCube !== !!target.isCube || !!source.depth !== !!target.depth ||
        source.levels < target.levels || ((source.usage | target.usage) & 0x400)) return null;
    const offset = source.levels - target.levels;
    for (let level = 0; level < target.levels; level++) {
        for (const key of ['width', 'height', 'depth'] as const) {
            if (Math.max(1, (source[key] ?? 1) >>> (level + offset)) !==
                Math.max(1, (target[key] ?? 1) >>> level)) return null;
        }
    }
    return offset;
}

export function createTextureTransferExports(): Record<string, ThunkImplementation> {
    const invalid = 0x8876086c;
    return {
        IDirect3DDevice9_StretchRect: (_ctx, _memory, args) => {
            const [devicePtr, sourcePtr, sourceRect, targetPtr, targetRect, filter] = args;
            const device = devices.get(devicePtr);
            const source = surfaceMeta.get(sourcePtr), target = surfaceMeta.get(targetPtr);
            device?.noteSurfaceCopy(`StretchRect src=0x${sourcePtr.toString(16)} ${JSON.stringify(source)} dst=0x${targetPtr.toString(16)} ${JSON.stringify(target)} filter=${filter}`);
            if (!device || !source || !target || source.pool !== 0 || target.pool !== 0 ||
                resourceToDevice.get(sourcePtr) !== device || resourceToDevice.get(targetPtr) !== device ||
                (source.usage & 2) || (target.usage & 2) || filter > 2) return invalid;
            const readRect = (ptr: number, width: number, height: number): CopyRect | null => {
                if (!ptr) return [0, 0, width, height];
                const values = Array.from({ length: 4 }, (_, i) => Mem.readUint32(ptr + i * 4));
                if (values.some(v => v === null)) return null;
                const rect = values as CopyRect;
                return validCopyRect(rect, width, height) ? rect : null;
            };
            const src = readRect(sourceRect, source.width, source.height), dst = readRect(targetRect, target.width, target.height);
            if (!src || !dst) return invalid;
            const copied = device.stretchSurface(source.texturePtr ?? 0, source.level ?? 0, source.face ?? 0, src,
                target.texturePtr ?? 0, target.level ?? 0, target.face ?? 0, dst, filter);
            device.noteSurfaceCopy(`StretchRect result=${copied} src=${src} dst=${dst}`);
            return copied ? 0 : invalid;
        },
        IDirect3DDevice9_UpdateTexture: (_ctx, _memory, args) => {
            const [devicePtr, sourcePtr, targetPtr] = args;
            const device = devices.get(devicePtr);
            const source = textureMeta.get(sourcePtr), target = textureMeta.get(targetPtr);
            if (!device || !source || !target || resourceToDevice.get(sourcePtr) !== device ||
                resourceToDevice.get(targetPtr) !== device || sourcePtr === targetPtr) return invalid;
            const offset = textureUpdateLevelOffset(source, target);
            return offset !== null && device.copyTextureLevels(sourcePtr, targetPtr, offset, target.levels) ? 0 : invalid;
        },
        IDirect3DTexture9_AddDirtyRect: (_ctx, _memory, args) => {
            const ptr = args[0];
            const device = resourceToDevice.get(ptr), meta = textureMeta.get(ptr);
            if (!device || !meta || meta.isCube || meta.depth) return invalid;
            if (args[1]) {
                const rect = Array.from({ length: 4 }, (_, i) => Mem.readUint32(args[1] + i * 4));
                if (rect.some(v => v === null)) return invalid;
                const [left, top, right, bottom] = rect as number[];
                if (left >= right || top >= bottom || right > meta.width || bottom > meta.height) return invalid;
            }
            return device.markTextureDirty(ptr) ? 0 : invalid;
        },
    };
}
