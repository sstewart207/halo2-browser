import { describe, expect, test } from "bun:test";
import { win32ImportSupplements } from "../../src/worker/api/win32-import-supplement";
import { ThunkGenerator } from "../../src/worker/core/thunking/thunk-generator";
import { Crypt32 } from "../../src/worker/modules/crypt32";

describe("supplemental PE import ABI", () => {
    test("generated x86 stubs preserve caller/callee stack ownership", () => {
        const generator = new ThunkGenerator();
        for (const descriptor of win32ImportSupplements) {
            const result = generator.generateStubDll(descriptor.name, descriptor.functions.map(f => ({
                name: f.name, argCount: f.params.length, callingConvention: f.callingConvention,
            })));
            for (const [index, func] of descriptor.functions.entries()) {
                const offset = index * 16 + 11;
                if (func.callingConvention === "cdecl" || func.params.length === 0) {
                    expect(result.stubCode[offset]).toBe(0xc3);
                } else {
                    expect(Array.from(result.stubCode.slice(offset, offset + 3))).toEqual([0xc2, func.params.length * 4, 0]);
                }
            }
        }
    });

    test("D3DX volume and surface loads consume all parameters", () => {
        const functions = win32ImportSupplements.find(m => m.name === "d3dx9")!.functions;
        expect(functions.find(f => f.name === "D3DXLoadVolumeFromMemory")!.params).toHaveLength(11);
        expect(functions.find(f => f.name === "D3DXLoadSurfaceFromMemory")!.params).toHaveLength(10);
    });

    test("DPAPI reports unsupported without altering guest buffers", () => {
        const process = { lastError: 0 };
        const module = new Crypt32();
        module.initialize(process as never);
        const memory = new Uint8Array(128).fill(0xa5);
        for (const name of ["CryptProtectData", "CryptUnprotectData"]) {
            process.lastError = 0;
            expect(module.exports[name]({} as never, memory, [8, 16, 24, 0, 0, 0, 48])).toEqual({ value: 0, stackCleanup: 28 });
            expect(process.lastError).toBe(50);
            expect(memory.every(byte => byte === 0xa5)).toBe(true);
        }
    });
});
