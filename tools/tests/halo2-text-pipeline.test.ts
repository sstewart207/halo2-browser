import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
    compileVertexShader,
    compilePixelShader,
    linkProgram,
    RawVertexElement,
} from "../../src/worker/backends/webgpu/d3d9/shader/index";

describe("Halo 2 Text Rendering Pipeline", () => {
    const shadersPath = resolve(__dirname, "../../../halo2-browser/scratch/ghidra/shaders.json");
    const shaders = JSON.parse(readFileSync(shadersPath, "utf-8"));

    const vsTokens = new Uint32Array(shaders.vs351);
    const psTokens = new Uint32Array(shaders.ps2);

    test("compiles VS351 and PS2 successfully", () => {
        const vs = compileVertexShader(vsTokens);
        const ps = compilePixelShader(psTokens);

        expect(vs.prog.major).toBe(2);
        expect(ps.prog.major).toBe(2);

        // Check VS inputs
        expect(vs.analysis.inputDcls).toEqual([
            { usage: 0, usageIndex: 0, reg: 0 }, // POSITION0 -> v0
            { usage: 5, usageIndex: 0, reg: 1 }, // TEXCOORD0 -> v1
            { usage: 10, usageIndex: 0, reg: 2 }, // COLOR0 -> v2
        ]);

        // Check PS samplers & interpolants
        expect([...ps.analysis.samplers]).toEqual([0]);
        expect(ps.analysis.readsTexcoord.has(0)).toBe(true);
        expect(ps.analysis.readsColor[0]).toBe(true);
    });

    test("links VS351 + PS2 with Format 0x23 declaration", () => {
        const vs = compileVertexShader(vsTokens);
        const ps = compilePixelShader(psTokens);

        // Format 0x23 decoded from Halo 2 binary:
        // offset 0: FLOAT2 (POSITION 0)
        // offset 8: FLOAT2 (TEXCOORD 0)
        // offset 16: D3DCOLOR (COLOR 0)
        const declElements: RawVertexElement[] = [
            { stream: 0, offset: 0, type: 1, usage: 0, usageIndex: 0 },
            { stream: 0, offset: 8, type: 1, usage: 5, usageIndex: 0 },
            { stream: 0, offset: 16, type: 4, usage: 10, usageIndex: 0 },
        ];

        const link = linkProgram({
            vs,
            ps,
            declElements,
            streamStride: 20,
        });

        expect(link.arrayStride).toBe(20);
        expect(link.hasTexture).toBe(true);

        console.log("=== Link attributes ===");
        console.log(JSON.stringify(link.vertexAttributes, null, 2));

        console.log("=== Link vertex buffers ===");
        console.log(JSON.stringify(link.vertexBuffers, null, 2));

        console.log("=== Link WGSL (first 60 lines) ===");
        console.log(link.wgsl.split("\n").slice(0, 60).join("\n"));

        // Verify attribute locations and offsets
        expect(link.vertexAttributes).toEqual([
            { shaderLocation: 0, offset: 0, format: "float32x2" },
            { shaderLocation: 1, offset: 8, format: "float32x2" },
            { shaderLocation: 2, offset: 16, format: "unorm8x4" },
        ]);
    });

    test("links VS351 when declElements is null (UP draw without decl set)", () => {
        const vs = compileVertexShader(vsTokens);
        const ps = compilePixelShader(psTokens);

        const linkNoDecl = linkProgram({
            vs,
            ps,
            declElements: null,
            streamStride: 20,
        });

        console.log("=== NO DECL: Link attributes ===");
        console.log(JSON.stringify(linkNoDecl.vertexAttributes, null, 2));
    });
});
