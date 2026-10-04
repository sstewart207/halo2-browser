import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Iphlpapi } from "../../src/worker/modules/iphlpapi";
import { iphlpapiModule } from "../../src/worker/api/iphlpapi.api";
import { RuntimeBridge } from "../../src/worker/core/recompiler/runtime-bridge";

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
    test("the AOT runtime bridge resolves a module called with a .dll suffix", () => {
        // The guest's import table names IPHLPAPI.DLL while modules register as
        // "iphlpapi"; a suffix-sensitive lookup threw "AOT API implementation missing".
        const seen: string[] = [];
        const bridge = new RuntimeBridge({
            memory: new WebAssembly.Memory({ initial: 1 }),
            memoryLength: 65536,
        });
        bridge.registerModule("iphlpapi", {
            GetAdaptersAddresses: (_ctx, _mem, args) => {
                seen.push("called");
                expect(args[0]).toBe(2);
                return { value: 232, stackCleanup: 20 };
            },
        });

        const view = new DataView(bridge.memory.buffer);
        const esp = 1024;
        view.setUint32(esp, 0xdeadbeef, true);      // return address
        view.setUint32(esp + 4, 2, true);           // Family = AF_INET
        view.setUint32(esp + 24, 4096, true);       // AdapterAddressesSize pointer

        expect(bridge.callApi("IPHLPAPI.DLL", "GetAdaptersAddresses", esp, 5)).toBe(232);
        expect(seen).toEqual(["called"]);
    });
    test("the worker initializes the module so its exports are populated", () => {
        // A module registered without initialize() exposes an empty exports map,
        // which surfaced as "AOT API implementation missing: IPHLPAPI.DLL!...".
        const worker = readFileSync(
            join(import.meta.dir, "..", "..", "src", "worker", "emulator.worker.ts"), "utf8");
        expect(worker).toContain("iphlpapi.initialize(process);");
        expect(worker).toContain("process.dispatcher.registerModule(iphlpapi.name, iphlpapi.exports)");
    });

    test("every HLE module registered in the worker populates its exports", () => {
        // Registration passes `module.exports`, so a module that never calls
        // initialize() (and does not fill exports in its constructor) is dead.
        const worker = readFileSync(
            join(import.meta.dir, "..", "..", "src", "worker", "emulator.worker.ts"), "utf8");
        const registered = [...worker.matchAll(/dispatcher\.registerModule\((\w+)\.name/g)].map(m => m[1]);
        expect(registered.length).toBeGreaterThan(10);
        const missing = registered.filter(name => !worker.includes(`${name}.initialize(`));
        // dbghelp fills its exports map in the constructor instead.
        expect(missing).toEqual(["dbghelp"]);
    });
});
