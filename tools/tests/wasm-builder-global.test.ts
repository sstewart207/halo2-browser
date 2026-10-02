import { expect, test } from 'bun:test';
import { WasmModuleBuilder } from '../recompiler/wasm-builder';

test('WasmModuleBuilder: emits mutable global and accesses via global.get / global.set', async () => {
    const builder = new WasmModuleBuilder();
    builder.exportMemory = true;

    // Add mutable global 0 initialized to 0x19ff00
    const espIdx = builder.addGlobal(0x7f, 1, 0x19ff00);
    expect(espIdx).toBe(0);

    // Export global as "esp"
    builder.addExport('esp', 3, espIdx);

    // Add function: getEsp() -> i32
    const sigGet = builder.addSignature([], [0x7f]);
    const fnGet = builder.addFunction('getEsp', sigGet);
    fnGet.global_get(espIdx);
    fnGet.return_op();
    builder.addExport('getEsp', 0, 0);

    // Add function: setEsp(val: i32)
    const sigSet = builder.addSignature([0x7f], []);
    const fnSet = builder.addFunction('setEsp', sigSet);
    fnSet.local_get(0);
    fnSet.global_set(espIdx);
    fnSet.return_op();
    builder.addExport('setEsp', 0, 1);

    const wasmBytes = builder.toBinary();
    expect(wasmBytes.length).toBeGreaterThan(0);

    const mod = await WebAssembly.compile(wasmBytes as any);
    const instance = await WebAssembly.instantiate(mod);
    const exports = instance.exports as any;

    expect(exports.esp).toBeDefined();
    expect(exports.esp.value).toBe(0x19ff00);
    expect(exports.getEsp()).toBe(0x19ff00);

    exports.setEsp(0x19fe00);
    expect(exports.esp.value).toBe(0x19fe00);
    expect(exports.getEsp()).toBe(0x19fe00);

    // Modify from JS side
    exports.esp.value = 0x123456;
    expect(exports.getEsp()).toBe(0x123456);
});
