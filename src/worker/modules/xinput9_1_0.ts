import { IModule } from "../core/module";
import { Process } from "../core/process";
import { ThunkImplementation } from "../core/thunking/thunk-dispatcher";

/**
 * xinput9_1_0.dll — HLE "no controller connected" XInput 9.1.0.
 *
 * Why HLE and not the native DLL: the native xinput9_1_0.dll from the game
 * install loads as real guest machine code (any VFS DLL without an HLE module
 * takes the PE-loader path) and immediately needs real HID device plumbing.
 * Halo 2's first XInputGetState call ran native xinput code that recursed into
 * itself until the stack ran off its arena (WASM 'unreachable' trap, ESP=0x7000).
 *
 * Faithful generic semantics instead: a Vista machine with no XInput devices
 * reports ERROR_DEVICE_NOT_CONNECTED for every query. Verified against the
 * native DLL's own disassembly — its "not connected" path is literally
 * `mov eax, 0x48F` (1167) with the caller's state buffer untouched. Games fall
 * back to keyboard/mouse (Halo 2 does exactly this via its DirectInput path).
 *
 * DualSense/real pad support is a later milestone and will route through
 * dinput; this module should keep reporting "not connected" until there is a
 * real device bridge.
 */

const ERROR_SUCCESS = 0;
const ERROR_BAD_ARGUMENTS = 87;
const ERROR_DEVICE_NOT_CONNECTED = 1167; // 0x48F — matches the native DLL's own constant

const XUSER_MAX_COUNT = 4;
const XUSER_INDEX_ANY = 0xfe; // valid only for XInputGetKeystroke

export class XInput910 implements IModule {
    name = "xinput9_1_0";
    exports: Record<string, ThunkImplementation> = {};

    initialize(_process: Process): void {
        // Index validation: dwUserIndex must be 0..XUSER_MAX_COUNT-1 unless the
        // documented XUSER_INDEX_ANY (0xFE) escape is allowed (GetKeystroke only).
        // Out-of-range indices are ERROR_BAD_ARGUMENTS BEFORE the (absent) device
        // is consulted — faithful Win32 argument validation order.
        const validate = (args: number[], allowIndexAny: boolean): number | null => {
            const index = args[0] >>> 0;
            if (index >= XUSER_MAX_COUNT && !(allowIndexAny && index === XUSER_INDEX_ANY)) {
                return ERROR_BAD_ARGUMENTS;
            }
            return null;
        };

        // DWORD XInputGetState(DWORD dwUserIndex, XINPUT_STATE *pState)
        // No device: 1167, pState untouched (matches native behavior — the
        // disassembly at xinputgetstate+0x2a reads its connected-table, then
        // returns 0x48F without writing the caller's buffer).
        const getState: ThunkImplementation = (_ctx, _mem, args) => {
            const bad = validate(args, false);
            if (bad !== null) return bad;
            return ERROR_DEVICE_NOT_CONNECTED;
        };

        // DWORD XInputSetState(DWORD dwUserIndex, XINPUT_VIBRATION *pVibration)
        const setState: ThunkImplementation = (_ctx, _mem, args) => {
            const bad = validate(args, false);
            if (bad !== null) return bad;
            return ERROR_DEVICE_NOT_CONNECTED;
        };

        // DWORD XInputGetCapabilities(DWORD dwUserIndex, DWORD dwFlags, XINPUT_CAPABILITIES *pCapabilities)
        const getCapabilities: ThunkImplementation = (_ctx, _mem, args) => {
            const bad = validate(args, false);
            if (bad !== null) return bad;
            return ERROR_DEVICE_NOT_CONNECTED;
        };

        // DWORD XInputGetDSoundAudioDeviceGuids(DWORD dwUserIndex, GUID *pRenderGuid, GUID *pCaptureGuid)
        // DWORD XInputGetBatteryInformation(DWORD dwUserIndex, BYTE devType, XINPUT_BATTERY_INFORMATION *pBatteryInformation)
        const deviceQuery: ThunkImplementation = (_ctx, _mem, args) => {
            const bad = validate(args, false);
            if (bad !== null) return bad;
            return ERROR_DEVICE_NOT_CONNECTED;
        };

        // DWORD XInputGetKeystroke(DWORD dwUserIndex, DWORD dwReserved, XINPUT_KEYSTROKE *pKeystroke)
        // dwUserIndex may be 0..3 or XUSER_INDEX_ANY (0xFE).
        const getKeystroke: ThunkImplementation = (_ctx, _mem, args) => {
            const bad = validate(args, true);
            if (bad !== null) return bad;
            return ERROR_DEVICE_NOT_CONNECTED;
        };

        // void XInputEnable(BOOL enable) — enables/disables all devices. With no
        // devices this is a no-op; EAX is unspecified on the real DLL (void),
        // returning 0 is safe.
        const enable: ThunkImplementation = () => ERROR_SUCCESS;

        this.exports["XInputGetState"] = getState;
        this.exports["XInputSetState"] = setState;
        this.exports["XInputGetCapabilities"] = getCapabilities;
        this.exports["XInputEnable"] = enable;
        this.exports["XInputGetDSoundAudioDeviceGuids"] = deviceQuery;
        this.exports["XInputGetBatteryInformation"] = deviceQuery;
        this.exports["XInputGetKeystroke"] = getKeystroke;

        // Undocumented ordinal exports (RE-inferred aliases used by the
        // xinput1_x/xinput9_1_0 family's internal dispatch tables; the native
        // DLL resolved ord_100..103 from its own handle at startup):
        //   100 XInputGetStateEx, 101 XInputSetState, 102 XInputGetCapabilities, 103 XInputEnable.
        // Halo 2 resolves the named exports; these aliases keep GetProcAddress
        // consumers from NULL-dereferring if they ask the undocumented way.
        this.exports["ord_100"] = getState;
        this.exports["ord_101"] = setState;
        this.exports["ord_102"] = getCapabilities;
        this.exports["ord_103"] = enable;
    }

    reset(): void {}
}
