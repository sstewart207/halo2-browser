/**
 * iat-resolver.ts — Parses the Win32 Import Address Table (IAT) from PE binaries
 * to map indirect call addresses directly to DLL and API names.
 */

import * as fs from 'fs';

export interface IATEntry {
    dll: string;
    func: string;
    ordinal?: number;
    iatAddress: number;
}

export class IATResolver {
    private addressToEntry = new Map<number, IATEntry>();
    private nameToAddress = new Map<string, number>();

    loadFromBuffer(buf: Buffer, loadBase?: number) {
        const e_lfanew = buf.readUInt32LE(0x3c);
        const numSections = buf.readUInt16LE(e_lfanew + 6);
        const optHeaderSize = buf.readUInt16LE(e_lfanew + 20);
        const optHeaderOffset = e_lfanew + 24;
        const imageBase = loadBase ?? buf.readUInt32LE(optHeaderOffset + 28);
        const importDirRVA = buf.readUInt32LE(optHeaderOffset + 104);
        const importDirSize = buf.readUInt32LE(optHeaderOffset + 108);

        if (importDirRVA === 0 || importDirSize === 0) return;

        // Section table
        const sectionTableOffset = optHeaderOffset + optHeaderSize;
        const sections: Array<{ vAddr: number; vSize: number; rawPtr: number }> = [];
        for (let i = 0; i < numSections; i++) {
            const secOffset = sectionTableOffset + i * 40;
            const vSize = buf.readUInt32LE(secOffset + 8);
            const vAddr = buf.readUInt32LE(secOffset + 12);
            const rawPtr = buf.readUInt32LE(secOffset + 20);
            sections.push({ vAddr, vSize, rawPtr });
        }

        const rvaToOffset = (rva: number): number | null => {
            for (const s of sections) {
                if (rva >= s.vAddr && rva < s.vAddr + s.vSize) {
                    return s.rawPtr + (rva - s.vAddr);
                }
            }
            return null;
        };

        let descOffset = rvaToOffset(importDirRVA);
        while (descOffset !== null && descOffset + 20 <= buf.length) {
            const iltRVA = buf.readUInt32LE(descOffset);
            const nameRVA = buf.readUInt32LE(descOffset + 12);
            const iatRVA = buf.readUInt32LE(descOffset + 16);
            if (nameRVA === 0) break;

            const nameOff = rvaToOffset(nameRVA);
            if (nameOff === null) break;
            let dllName = '';
            for (let i = nameOff; i < buf.length && buf[i] !== 0; i++) {
                dllName += String.fromCharCode(buf[i]);
            }
            dllName = dllName.toLowerCase().replace(/\.dll$/i, '');

            let thunkRVA = iltRVA || iatRVA;
            let thunkOff = rvaToOffset(thunkRVA);
            let curIatRVA = iatRVA;

            while (thunkOff !== null && thunkOff + 4 <= buf.length) {
                const entry = buf.readUInt32LE(thunkOff);
                if (entry === 0) break;
                const iatVA = imageBase + curIatRVA;
                let funcName = '';
                let ordinal: number | undefined;

                if ((entry & 0x80000000) === 0) {
                    const hintOff = rvaToOffset(entry);
                    if (hintOff !== null) {
                        for (let i = hintOff + 2; i < buf.length && buf[i] !== 0; i++) {
                            funcName += String.fromCharCode(buf[i]);
                        }
                    }
                } else {
                    ordinal = entry & 0xffff;
                    funcName = `ord_${ordinal}`;
                }

                if (funcName) {
                    const iatEntry: IATEntry = {
                        dll: dllName,
                        func: funcName,
                        ordinal,
                        iatAddress: iatVA,
                    };
                    this.addressToEntry.set(iatVA, iatEntry);
                    this.nameToAddress.set(`${dllName}:${funcName}`.toLowerCase(), iatVA);
                }

                thunkOff += 4;
                curIatRVA += 4;
            }
            descOffset += 20;
        }
    }

    loadFromFile(filePath: string) {
        if (!fs.existsSync(filePath)) return;
        const buf = fs.readFileSync(filePath);
        this.loadFromBuffer(buf);
    }

    resolve(address: number): IATEntry | undefined {
        return this.addressToEntry.get(address);
    }

    size(): number {
        return this.addressToEntry.size;
    }

    getAllEntries(): IATEntry[] {
        return Array.from(this.addressToEntry.values());
    }
}
