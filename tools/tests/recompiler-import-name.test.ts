import {expect, it} from 'bun:test';
import {parseAotApiImport} from '../../src/worker/core/recompiler/import-name';

it('preserves underscores in DLL names and ordinal functions', () => {
    expect(parseAotApiImport('win32_ws2_32_ord_9', ['WS2_32.dll'])).toEqual({dll:'ws2_32',func:'ord_9'});
    expect(parseAotApiImport('win32_kernel32_GetVersionExA', ['kernel32.dll'])).toEqual({dll:'kernel32',func:'GetVersionExA'});
});
it('uses the longest actual DLL name and rejects unknown imports', () => {
    expect(parseAotApiImport('win32_some_dll_fn_name', ['some.dll','some_dll.dll'])).toEqual({dll:'some_dll',func:'fn_name'});
    expect(()=>parseAotApiImport('win32_unknown_Test', ['kernel32.dll'])).toThrow('no matching PE DLL');
});
