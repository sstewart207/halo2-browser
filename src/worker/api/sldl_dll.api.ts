import { ModuleDescriptor, FunctionDescriptor, ParameterDescriptor } from "./types";

const buildParams = (count: number): ParameterDescriptor[] => {
    const params: ParameterDescriptor[] = [];
    for (let i = 0; i < count; i++) {
        params.push({ name: `arg${i}`, type: "u32" });
    }
    return params;
};

const makeFunc = (name: string, argCount: number): FunctionDescriptor => ({
    name,
    params: buildParams(argCount),
    returnType: "u32",
    callingConvention: "stdcall",
});

// Argument counts follow the documented Windows Software Licensing (SL*) API
// that SLDL_DLL wraps (slpublic.h). SLDLInitialize is not part of that public
// API; its count is unverified and it is not known to be called by the game.
export const sldl_dllModule: ModuleDescriptor = {
    name: "sldl_dll",
    functions: [
        makeFunc("SLDLInitialize", 0),
        makeFunc("SLDLOpen", 1),
        makeFunc("SLDLClose", 1),
        makeFunc("SLDLGetSLIDList", 6),
        makeFunc("SLDLConsumeRight", 5),
        makeFunc("SLDLGetLicensingStatusInformation", 6),
        makeFunc("SLDLGetInformation", 6),
    ],
};
