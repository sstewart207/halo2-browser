import { describe, expect, test } from "bun:test";
import { Iphlpapi } from "../../src/worker/modules/iphlpapi";
import { iphlpapiModule } from "../../src/worker/api/iphlpapi.api";

function fixture() {
    const module = new Iphlpapi();
    module.initialize({} as never);
    const memory = new Uint8Array(64).fill(0xa5);
    const view = new DataView(memory.buffer);
    const call = (name: string, args: number[]) => module.exports[name]({} as never, memory, args);
    return { view, call };
}

describe("offline IP Helper API", () => {
    test("the PE loader knows every implemented stdcall argument count", () => {
        const counts = Object.fromEntries(iphlpapiModule.functions.map(f => [f.name, f.params.length]));
        expect(counts).toMatchObject({ GetBestInterface: 2, GetIpAddrTable: 3, GetAdaptersAddresses: 5 });
    });

    test("empty address table supports the size probe and preserves too-small buffers", () => {
        const { view, call } = fixture();
        view.setUint32(8, 0, true);
        expect(call("GetIpAddrTable", [0, 8, 0])).toEqual({ value: 122, stackCleanup: 12 });
        expect(view.getUint32(8, true)).toBe(4);
        view.setUint32(8, 2, true);
        expect(call("GetIpAddrTable", [16, 8, 1])).toEqual({ value: 122, stackCleanup: 12 });
        expect(view.getUint32(16, true)).toBe(0xa5a5a5a5);
        view.setUint32(8, 4, true);
        expect(call("GetIpAddrTable", [16, 8, 1])).toEqual({ value: 0, stackCleanup: 12 });
        expect(view.getUint32(16, true)).toBe(0);
    });

    test("invalid size pointers fail without throwing", () => {
        const { call } = fixture();
        expect(call("GetIpAddrTable", [16, 0, 0])).toEqual({ value: 87, stackCleanup: 12 });
        expect(call("GetIpAddrTable", [16, 62, 0])).toEqual({ value: 87, stackCleanup: 12 });
    });

    test("adapter queries distinguish no-data from invalid parameters", () => {
        const { call } = fixture();
        for (const family of [0, 2, 23]) {
            expect(call("GetAdaptersAddresses", [family, 0, 0, 0, 8])).toEqual({ value: 232, stackCleanup: 20 });
        }
        expect(call("GetAdaptersAddresses", [1, 0, 0, 0, 8])).toEqual({ value: 87, stackCleanup: 20 });
        expect(call("GetAdaptersAddresses", [2, 0, 0, 0, 0])).toEqual({ value: 87, stackCleanup: 20 });
        expect(call("GetBestInterface", [0, 0])).toEqual({ value: 87, stackCleanup: 8 });
        expect(call("GetBestInterface", [0, 8])).toEqual({ value: 50, stackCleanup: 8 });
    });
});
