import { describe, expect, test } from "bun:test";
import { SldlDll } from "../../src/worker/modules/sldl_dll";

describe("sldl_dll out-param verification", () => {
    test("SLDLOpen writes non-zero handle", () => {
        const m = new SldlDll();
        m.initialize({} as never);
        const mem = new Uint8Array(64);
        const view = new DataView(mem.buffer);
        // ptr at offset 16
        const ret = m.exports["SLDLOpen"]({} as never, mem, [16]);
        expect(ret).toBe(0);
        expect(view.getUint32(16, true)).toBe(0x534c4443);
    });

    test("SLDLGetSLIDList zeroes out count and array pointer", () => {
        const m = new SldlDll();
        m.initialize({} as never);
        const mem = new Uint8Array(64).fill(0xff);
        const view = new DataView(mem.buffer);
        // args: hSLC, eQueryIdType, pQueryId, eReturnIdType, pnReturnIds, ppReturnIds
        const ret = m.exports["SLDLGetSLIDList"]({} as never, mem, [0, 0, 0, 0, 16, 20]);
        expect(ret).toBe(0);
        expect(view.getUint32(16, true)).toBe(0); // count zeroed
        expect(view.getUint32(20, true)).toBe(0); // buffer pointer zeroed
    });

    test("SLDLGetLicensingStatusInformation zeroes out status count and pointer", () => {
        const m = new SldlDll();
        m.initialize({} as never);
        const mem = new Uint8Array(64).fill(0xee);
        const view = new DataView(mem.buffer);
        // args: hSLC, pAppID, pSkuId, pwszRight, pnStatusCount, pp
        const ret = m.exports["SLDLGetLicensingStatusInformation"]({} as never, mem, [0, 0, 0, 0, 24, 28]);
        expect(ret).toBe(0);
        expect(view.getUint32(24, true)).toBe(0);
        expect(view.getUint32(28, true)).toBe(0);
    });
});
