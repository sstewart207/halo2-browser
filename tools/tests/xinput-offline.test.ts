import { describe, expect, test } from "bun:test";
import { XInput910 } from "../../src/worker/modules/xinput9_1_0";
import { xinput9_1_0Module } from "../../src/worker/api/xinput9_1_0.api";

const ERROR_BAD_ARGUMENTS = 87;
const ERROR_DEVICE_NOT_CONNECTED = 1167;

function fixture() {
    const module = new XInput910();
    module.initialize({} as never);
    // A state buffer the caller would pass; "not connected" must leave it intact.
    const memory = new Uint8Array(64).fill(0xa5);
    const view = new DataView(memory.buffer);
    const call = (name: string, args: number[]) => module.exports[name]({} as never, memory, args);
    return { view, call };
}

describe("offline xinput9_1_0 (no controller connected)", () => {
    test("the PE loader knows every implemented stdcall argument count", () => {
        const counts = Object.fromEntries(xinput9_1_0Module.functions.map(f => [f.name, f.params.length]));
        expect(counts).toMatchObject({
            XInputGetState: 2,
            XInputSetState: 2,
            XInputGetCapabilities: 3,
            XInputEnable: 1,
            XInputGetDSoundAudioDeviceGuids: 3,
            XInputGetBatteryInformation: 3,
            XInputGetKeystroke: 3,
            ord_100: 2,
            ord_101: 2,
            ord_102: 3,
            ord_103: 1,
        });
        expect(xinput9_1_0Module.name).toBe("xinput9_1_0");
    });

    test("every user query reports ERROR_DEVICE_NOT_CONNECTED and never writes the caller's buffer", () => {
        const { view, call } = fixture();
        for (const name of ["XInputGetState", "XInputSetState", "XInputGetCapabilities",
            "XInputGetDSoundAudioDeviceGuids", "XInputGetBatteryInformation", "XInputGetKeystroke"]) {
            for (const index of [0, 1, 2, 3]) {
                expect(call(name, [index, 0x1000, 0x1008, 0x1010])).toBe(ERROR_DEVICE_NOT_CONNECTED);
            }
            // Nothing was written through any of the caller's pointers.
            expect(view.getUint32(0, true)).toBe(0xa5a5a5a5);
        }
    });

    test("invalid user indices are rejected before the (absent) device is consulted", () => {
        const { call } = fixture();
        for (const name of ["XInputGetState", "XInputSetState", "XInputGetCapabilities",
            "XInputGetDSoundAudioDeviceGuids", "XInputGetBatteryInformation", "XInputGetKeystroke"]) {
            for (const index of [4, 5, 0xff, 0xffffffff]) {
                expect(call(name, [index, 0, 0, 0])).toBe(ERROR_BAD_ARGUMENTS);
            }
        }
    });

    test("XInputGetKeystroke alone accepts XUSER_INDEX_ANY (0xfe)", () => {
        const { call } = fixture();
        expect(call("XInputGetKeystroke", [0xfe, 0, 0])).toBe(ERROR_DEVICE_NOT_CONNECTED);
        // The other entry points keep rejecting it.
        expect(call("XInputGetState", [0xfe, 0])).toBe(ERROR_BAD_ARGUMENTS);
        expect(call("XInputSetState", [0xfe, 0])).toBe(ERROR_BAD_ARGUMENTS);
    });

    test("XInputEnable is a harmless no-op and the ordinal aliases match their named twins", () => {
        const { call } = fixture();
        expect(call("XInputEnable", [1])).toBe(0);
        expect(call("XInputEnable", [0])).toBe(0);
        expect(call("ord_100", [0, 0x1000])).toBe(ERROR_DEVICE_NOT_CONNECTED);
        expect(call("ord_101", [0, 0x1000])).toBe(ERROR_DEVICE_NOT_CONNECTED);
        expect(call("ord_102", [0, 0, 0x1000])).toBe(ERROR_DEVICE_NOT_CONNECTED);
        expect(call("ord_103", [1])).toBe(0);
    });
});
