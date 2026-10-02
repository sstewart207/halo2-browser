import { ModuleDescriptor, FunctionDescriptor, ParameterDescriptor } from "./types";

const buildParams = (count: number): ParameterDescriptor[] => {
    const params: ParameterDescriptor[] = [];
    for (let i = 0; i < count; i++) {
        params.push({ name: `arg${i}`, type: "u32" });
    }
    return params;
};

const makeFunc = (name: string, argCount: number, overrides: Partial<FunctionDescriptor> = {}): FunctionDescriptor => ({
    name,
    params: overrides.params ?? buildParams(argCount),
    returnType: overrides.returnType ?? "u32",
    callingConvention: overrides.callingConvention ?? "stdcall",
});

export const xinput9_1_0Module: ModuleDescriptor = {
    name: "xinput9_1_0",
    functions: [
        // DWORD XInputGetState(DWORD dwUserIndex, XINPUT_STATE *pState)
        makeFunc("XInputGetState", 2),
        // DWORD XInputSetState(DWORD dwUserIndex, XINPUT_VIBRATION *pVibration)
        makeFunc("XInputSetState", 2),
        // DWORD XInputGetCapabilities(DWORD dwUserIndex, DWORD dwFlags, XINPUT_CAPABILITIES *pCapabilities)
        makeFunc("XInputGetCapabilities", 3),
        // void XInputEnable(BOOL enable)
        makeFunc("XInputEnable", 1),
        // DWORD XInputGetDSoundAudioDeviceGuids(DWORD dwUserIndex, GUID *pRenderGuid, GUID *pCaptureGuid)
        makeFunc("XInputGetDSoundAudioDeviceGuids", 3),
        // DWORD XInputGetBatteryInformation(DWORD dwUserIndex, BYTE devType, XINPUT_BATTERY_INFORMATION *pBatteryInformation)
        makeFunc("XInputGetBatteryInformation", 3),
        // DWORD XInputGetKeystroke(DWORD dwUserIndex, DWORD dwReserved, XINPUT_KEYSTROKE *pKeystroke)
        makeFunc("XInputGetKeystroke", 3),
        // RE-inferred ordinal aliases (see modules/xinput9_1_0.ts for the mapping)
        makeFunc("ord_100", 2),
        makeFunc("ord_101", 2),
        makeFunc("ord_102", 3),
        makeFunc("ord_103", 1),
    ],
};
