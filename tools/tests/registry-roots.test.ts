import { expect, test } from 'bun:test';
import { RegistryStore } from '../../src/worker/runtime/filesystem/registry';

const path = 'CLSID\\{f5078f32-c551-11d3-89b9-0000f81fe221}\\InprocServer32';
const values = [{ name: '', type: 'REG_SZ' as const, data: 'C:\\msxml3.dll' }];

test('COM registration seeded as HKCR is visible through the full root name', () => {
    const store = new RegistryStore();
    store.seed({ root: 'HKCR', path, values });
    const key = store.open('HKEY_CLASSES_ROOT', path.toUpperCase());
    expect(key).not.toBeNull();
    expect(store.getValue(key!, '')?.data).toBe('C:\\msxml3.dll');
    expect(store.enumSubKeys('HKEY_CLASSES_ROOT\\CLSID')).toEqual(['{f5078f32-c551-11d3-89b9-0000f81fe221}']);
});

test('full root seeds share keys with Win32 predefined handles and deletion', () => {
    const store = new RegistryStore();
    store.seed({ root: 'HKEY_LOCAL_MACHINE', path: 'Software\\Example', values });
    const key = store.open('HKLM', 'Software\\Example');
    expect(key).not.toBeNull();
    expect(store.getValue(key!, '')?.data).toBe('C:\\msxml3.dll');
    expect(store.deleteValue('HKEY_LOCAL_MACHINE\\Software\\Example', '')).toBe(true);
    expect(store.getValue(key!, '')).toBeNull();
});

test('persisted full root registrations survive canonicalization and round trips', () => {
    const store = new RegistryStore();
    store.restore({ version: 2, gameId: 'test', lastModified: 0,
        keys: { ['HKEY_CLASSES_ROOT\\' + path]: { '': values[0] } } });
    const key = store.open('HKCR', path);
    expect(store.getValue(key!, '')?.data).toBe('C:\\msxml3.dll');
    const restored = new RegistryStore();
    restored.restore(store.serialize());
    expect(restored.getValue(restored.open('HKEY_CLASSES_ROOT', path)!, '')?.data).toBe('C:\\msxml3.dll');
});
