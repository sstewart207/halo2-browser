import type { FunctionDescriptor, ModuleDescriptor } from "./types";

// ABI metadata only: resolving an import does not imply that its implementation
// is supported. All parameters below occupy one DWORD in the 32-bit ABI.
// Windows signatures: Windows SDK 10.0.26100.0, um headers.
// D3DX signatures: learn.microsoft.com/windows/win32/direct3d9/d3dx*.
const module = (name: string, entries: Array<[string, number]>, callingConvention: "stdcall" | "cdecl" = "stdcall"): ModuleDescriptor => ({
    name,
    functions: entries.map(([name, count]): FunctionDescriptor => ({
        name,
        params: Array.from({ length: count }, (_, i) => ({ name: `arg${i}`, type: "u32" })),
        returnType: "u32",
        callingConvention,
    })),
});

export const win32ImportSupplements: ModuleDescriptor[] = [
    module("imm32", [["ImmGetDefaultIMEWnd", 1], ["ImmGetVirtualKey", 1]]),
    module("user32", [["SendInput", 3], ["VkKeyScanExW", 2],
        ["IsCharAlphaW", 1], ["CharUpperBuffW", 2], ["IsCharUpperW", 1]]),
    module("advapi32", [
        ["CryptGetHashParam", 5], ["CryptGenKey", 4], ["CryptSetKeyParam", 4],
        ["CryptGetKeyParam", 5], ["CryptExportKey", 6], ["CryptEncrypt", 7],
        ["CryptDecrypt", 6], ["CryptSignHashA", 6], ["CryptGetUserKey", 3],
        ["StartServiceW", 3], ["QueryServiceStatus", 2], ["SystemFunction036", 2],
        ["GetCurrentHwProfileW", 1], ["TraceEvent", 3], ["OpenThreadToken", 4],
        ["ImpersonateSelf", 1], ["RevertToSelf", 0],
    ]),
    module("ole32", [["CoInitializeSecurity", 9], ["CreateStreamOnHGlobal", 3], ["CLSIDFromProgID", 2]]),
    module("crypt32", [
        ["CryptStringToBinaryW", 7], ["CryptBinaryToStringW", 5],
        ["CryptProtectData", 7], ["CryptUnprotectData", 7],
    ]),
    module("d3dx9", [
        ["D3DXCompileShader", 10], ["D3DXCreateTexture", 8],
        ["D3DXLoadVolumeFromMemory", 11], ["D3DXLoadSurfaceFromMemory", 10],
    ]),
    module("shlwapi", [["StrStrIW", 2], ["StrStrIA", 2],
        ["PathSearchAndQualifyW", 3], ["StrCmpW", 2], ["StrToIntW", 1], ["StrCmpNIW", 3],
        ["UrlIsW", 2], ["PathIsURLW", 1], ["UrlGetLocationW", 1],
        ["PathCreateFromUrlW", 4], ["UrlCreateFromPathW", 4], ["UrlCanonicalizeW", 4]]),
    module("dbghelp", [["MiniDumpWriteDump", 7]]),
    module("ws2_32", [
        ["getaddrinfo", 4], ["getnameinfo", 7], ["freeaddrinfo", 1], ["inet_ntop", 4],
        ["WSARecv", 7], ["WSAGetOverlappedResult", 5], ["WSASocketW", 6], ["WSASend", 7],
    ]),
    module("psapi", [["EnumProcesses", 3], ["EnumProcessModulesEx", 5]]),
    module("kernel32", [
        ["ConnectNamedPipe", 2], ["DisconnectNamedPipe", 1], ["WaitNamedPipeW", 2],
        ["GetDynamicTimeZoneInformation", 1],
        ["IsWow64Process", 2], ["DeleteTimerQueueEx", 2],
        ["OpenSemaphoreW", 3], ["OpenThreadToken", 4],
        ["ResolveDelayLoadedAPI", 6], ["DelayLoadFailureHook", 2], ["ApiSetQueryApiSetPresence", 2],
    ]),
    module("ntdll", [["RtlUnwind", 4], ["RtlCaptureContext", 1],
        ["RtlFindClearBits", 3], ["RtlClearBit", 2], ["RtlInitializeBitMap", 3],
        ["RtlFindClearBitsAndSet", 3], ["NtQuerySystemInformation", 4],
        // Installed x86 ntdll syscall/telemetry entry points end in RET 24 / RET 12.
        // ABI only; neither export is implemented by adding this descriptor.
        ["NtQuerySecurityPolicy", 6], ["WinSqmSetDWORD", 3]]),
    module("bcrypt", [
        ["BCryptCreateHash", 7], ["BCryptOpenAlgorithmProvider", 4], ["BCryptHashData", 4],
        ["BCryptGenRandom", 4], ["BCryptCloseAlgorithmProvider", 2], ["BCryptGetProperty", 6],
        ["BCryptDestroyHash", 1], ["BCryptFinishHash", 4],
    ]),
    module("rpcrt4", [["I_RpcMapWin32Status", 1]]),
    module("powrprof", [["CallNtPowerInformation", 5]]),
    module("mfplat", [["MFStartup", 2], ["MFShutdown", 0]]),
    module("mf", [["MFCreateTopology", 1], ["MFCreateMediaSession", 2],
        ["MFCreateAudioRendererActivate", 1], ["MFCreateVideoRendererActivate", 2],
        ["MFCreateTopologyNode", 2], ["MFCreateSourceResolver", 1], ["MFGetService", 4]]),
    module("oleaut32", [["VarBstrCmp", 4]]),
    // _ui64tow has a 64-bit integer followed by two pointers/scalars: four
    // DWORD stack slots. CRT functions are caller-cleaned, including varargs.
    module("msvcrt", [
        ["_itow", 3], ["_ui64tow", 4], ["wcsrchr", 2],
        ["_wtof", 1], ["swscanf", 2], ["_wtol", 1],
    ], "cdecl"),
];
