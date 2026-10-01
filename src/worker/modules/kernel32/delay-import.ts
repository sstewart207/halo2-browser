/** Decode a PE32 delay-import descriptor and its selected IAT slot. */
export interface DelayImport {
    dllNameAddress: number;
    moduleHandleAddress: number;
    procedureAddressOrOrdinal: number;
    byName: boolean;
}

export function readDelayImport(mem: Uint8Array, imageBase: number, descriptor: number, thunk: number): DelayImport | null {
    const fits = (address: number, size: number) => Number.isSafeInteger(address) && address > 0 && address + size <= mem.length;
    if (!fits(descriptor, 32) || !fits(thunk, 4)) return null;
    const view = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
    const attributes = view.getUint32(descriptor, true);
    if (attributes !== 0 && attributes !== 1) return null;
    const address = (offset: number) => {
        const value = view.getUint32(descriptor + offset, true);
        return value ? value + (attributes & 1 ? imageBase : 0) : 0;
    };
    const dllNameAddress = address(4);
    const moduleHandleAddress = address(8);
    const iat = address(12);
    const names = address(16);
    if (!fits(dllNameAddress, 1) || !fits(moduleHandleAddress, 4) || !fits(iat, 4) || !fits(names, 4)) return null;
    const offset = thunk - iat;
    if (offset < 0 || offset % 4 !== 0 || !fits(names + offset, 4)) return null;
    // A pointer beyond the table terminator cannot select another memory region.
    for (let slot = 0; slot <= offset; slot += 4) {
        if (!fits(names + slot, 4) || view.getUint32(names + slot, true) === 0) return null;
    }
    const target = view.getUint32(names + offset, true);
    const byName = (target & 0x80000000) === 0;
    const procedureAddressOrOrdinal = byName
        ? target + (attributes & 1 ? imageBase : 0) + 2
        : target & 0xffff;
    if (byName && !fits(procedureAddressOrOrdinal, 1)) return null;
    return { dllNameAddress, moduleHandleAddress, procedureAddressOrOrdinal, byName };
}
