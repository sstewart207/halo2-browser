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

export const powrprofModule: ModuleDescriptor = {
    name: "powrprof",
    functions: [
        // NTSTATUS CallNtPowerInformation(POWER_INFORMATION_LEVEL, PVOID in, ULONG inLen, PVOID out, ULONG outLen)
        makeFunc("CallNtPowerInformation", 5),
    ],
};
