import { getD3DTextureLayout, decodeD3DTextureToRgba8 } from '../shared/texture-formats';

export function volumeMipLayouts(width: number, height: number, depth: number, levels: number, format: number) {
    let offset = 0;
    return Array.from({ length: levels }, (_, level) => {
        const w = Math.max(1, width >>> level), h = Math.max(1, height >>> level), d = Math.max(1, depth >>> level);
        const layout = getD3DTextureLayout(format, w, h);
        const mip = { width: w, height: h, depth: d, rowPitch: layout.pitch, slicePitch: layout.bytes, offset, bytes: layout.bytes * d };
        offset += mip.bytes;
        return mip;
    });
}

/** Contiguous native-format guest backing; each mip shrinks in all three dimensions. */
export class D3D9VolumeData {
    readonly mips: ReturnType<typeof volumeMipLayouts>;
    private locks = new Map<number, number>();
    dirty = true;

    constructor(readonly base: number, width: number, height: number, depth: number, levels: number, readonly format: number) {
        this.mips = volumeMipLayouts(width, height, depth, levels, format);
    }

    lock(level: number, box: number[] | null, flags: number) {
        const mip = this.mips[level];
        if (!mip || this.locks.has(level)) return null;
        let offset = 0;
        if (box) {
            const [left, top, right, bottom, front, back] = box;
            if (left >= right || top >= bottom || front >= back || right > mip.width || bottom > mip.height || back > mip.depth) return null;
            const layout = getD3DTextureLayout(this.format, mip.width, mip.height);
            if (layout.compressed) {
                if ((left % 4) || (top % 4) || ((right % 4) && right !== mip.width) || ((bottom % 4) && bottom !== mip.height)) return null;
                offset = front * mip.slicePitch + (top >> 2) * mip.rowPitch + (left >> 2) * layout.blockBytes;
            } else {
                offset = front * mip.slicePitch + top * mip.rowPitch + left * (mip.rowPitch / mip.width);
            }
        }
        if (box && (flags & 0x2000)) return null; // DISCARD cannot lock a sub-box.
        this.locks.set(level, flags);
        return { ptr: this.base + mip.offset + offset, rowPitch: mip.rowPitch, slicePitch: mip.slicePitch };
    }

    unlock(level: number): boolean {
        const flags = this.locks.get(level);
        if (flags === undefined) return false;
        this.locks.delete(level);
        if (!(flags & (0x10 | 0x8000))) this.dirty = true; // READONLY / NO_DIRTY_UPDATE
        return true;
    }

    rgba(level: number, memory: Uint8Array): Uint8Array {
        const mip = this.mips[level];
        const rgba = new Uint8Array(mip.width * mip.height * mip.depth * 4);
        const planeBytes = mip.width * mip.height * 4;
        for (let z = 0; z < mip.depth; z++) {
            decodeD3DTextureToRgba8(memory, this.base + mip.offset + z * mip.slicePitch, mip.width, mip.height, this.format,
                { pitch: mip.rowPitch, out: rgba.subarray(z * planeBytes, (z + 1) * planeBytes) });
        }
        return rgba;
    }
}
