import { expect, test } from 'bun:test';
import { resolveThunkedDllAlias } from '../../src/worker/core/dll-aliases';
import { msvcrtModule } from '../../src/worker/api/msvcrt.api';
import { ThunkGenerator } from '../../src/worker/core/thunking/thunk-generator';

test('MSXML imports route to the correct semantic host, including non-kernel contracts', () => {
    expect(resolveThunkedDllAlias('C:\\WINDOWS\\SYSTEM32\\API-MS-WIN-CORE-LIBRARYLOADER-L1-2-0.DLL')).toBe('kernel32');
    expect(resolveThunkedDllAlias('api-ms-win-core-com-l1-1-0.dll')).toBe('ole32');
    expect(resolveThunkedDllAlias('api-ms-win-core-string-l2-1-0.dll')).toBe('user32');
    expect(resolveThunkedDllAlias('api-ms-win-core-registry-l1-1-0.dll')).toBe('advapi32');
    expect(resolveThunkedDllAlias('api-ms-win-core-url-l1-1-0.dll')).toBe('shlwapi');
    expect(resolveThunkedDllAlias('api-ms-win-core-rtlsupport-l1-1-0.dll')).toBe('ntdll');
    expect(resolveThunkedDllAlias('api-ms-win-core-unknown-l1-1-0.dll')).toBe('api-ms-win-core-unknown-l1-1-0');
    expect(resolveThunkedDllAlias('api-ms-win-core-com-l99-0-0.dll')).toBe('api-ms-win-core-com-l99-0-0');
});

test('MSXML CRT imports leave argument cleanup to their caller', () => {
    for (const [name, count] of [['_resetstkoflw', 0], ['memcpy_s', 4]] as const) {
        const descriptor = msvcrtModule.functions.find(f => f.name === name)!;
        expect(descriptor.params.length).toBe(count);
        expect(descriptor.callingConvention).toBe('cdecl');
        const generated = new ThunkGenerator().generateStubDll('msvcrt', [{
            name, argCount: count, callingConvention: descriptor.callingConvention,
        }]);
        expect(generated.stubCode[11]).toBe(0xc3); // RET, never RET 16
    }
});
