import { describe, expect, test } from "bun:test";
import { SldlDll } from "../../src/worker/modules/sldl_dll";
import { sldl_dllModule } from "../../src/worker/api/sldl_dll.api";

describe("sldl_dll HLE", () => {
    test("every API-descriptor function has an implementation returning S_OK", () => {
        const m = new SldlDll();
        m.initialize({} as never);
        for (const f of sldl_dllModule.functions) {
            expect(m.exports[f.name]).toBeDefined();
            expect(m.exports[f.name]({} as never, new Uint8Array(16), [])).toBe(0);
        }
    });
    test("documented SL argument counts", () => {
        const c = Object.fromEntries(sldl_dllModule.functions.map(f => [f.name, f.params.length]));
        expect(c).toMatchObject({ SLDLOpen: 1, SLDLClose: 1, SLDLGetSLIDList: 6, SLDLConsumeRight: 5, SLDLGetLicensingStatusInformation: 6, SLDLGetInformation: 6 });
    });
});
