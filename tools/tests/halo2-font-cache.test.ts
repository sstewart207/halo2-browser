import {test,expect} from 'bun:test';
import {enlargeHalo2FontCache,HALO2_FONT_CACHE_PATCHES} from '../../src/worker/core/halo2-font-cache';
function image() {
    const memory = new Uint8Array(0x90000);
    const view = new DataView(memory.buffer);
    for(const p of HALO2_FONT_CACHE_PATCHES) {memory[p.rva]=0x68;view.setUint32(p.rva+1,p.oldValue,true);}
    return memory;
}
test('glyph backing and block count agree while original entry capacities are preserved',()=>{
    const memory=image();expect(enlargeHalo2FontCache(memory,0,'HALO2.EXE')).toBe(true);
    const view=new DataView(memory.buffer);
    for(const p of HALO2_FONT_CACHE_PATCHES) expect(view.getUint32(p.rva+1,true)).toBe(p.value);
    expect(HALO2_FONT_CACHE_PATCHES[3].value * 32).toBe(HALO2_FONT_CACHE_PATCHES[0].value);
});
test('unknown build and other executable are unchanged, never partially patched',()=>{
    const memory=image();memory[0x8d8eb]=0x90;const original=memory.slice();
    expect(enlargeHalo2FontCache(memory,0,'halo2.exe')).toBe(false);expect(memory).toEqual(original);
    const other=image();expect(enlargeHalo2FontCache(other,0,'other.exe')).toBe(false);
    expect(enlargeHalo2FontCache(new Uint8Array(16),0,'halo2.exe')).toBe(false);
});
