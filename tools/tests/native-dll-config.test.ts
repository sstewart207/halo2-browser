import { expect, test } from 'bun:test';
import { EmulatorConfig } from '../../src/worker/core/emulator-config-manager';

test('native DLL preferences are exact filenames, not all aliases, and reset between bundles', () => {
    const config = EmulatorConfig.getInstance();
    config.reset();
    config.applyFromManifest({ formatVersion: 2, name: 'test', entrypoint: 'rom/test.exe',
        emulator: { nativeDlls: ['C:\\Windows\\SysWOW64\\D3DX9_31.DLL'] } });
    expect(config.prefersNativeDll('d3dx9_31')).toBe(true);
    expect(config.prefersNativeDll('C:/bundle/d3dx9_31.dll')).toBe(true);
    expect(config.prefersNativeDll('d3dx9_43.dll')).toBe(false);
    expect(config.prefersNativeDll('d3dx9.dll')).toBe(false);
    config.reset();
    expect(config.prefersNativeDll('d3dx9_31.dll')).toBe(false);
});
