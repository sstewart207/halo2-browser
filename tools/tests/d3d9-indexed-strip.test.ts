import {test, expect} from 'bun:test';
import {expandIndexedStrip} from '../../src/worker/backends/webgpu/d3d9/indexed-strip';

test('indexed strip preserves alternating winding, offsets and legitimate 0xffff indices', () => {
    const data = new Uint16Array([99, 2, 4, 0xffff, 8, 10]);
    expect([...expandIndexedStrip(new Uint8Array(data.buffer), 2, 1, 3)!]).toEqual([2,4,65535,65535,4,8,65535,8,10]);
});
test('32-bit strip handles degenerates and byte-offset views without truncating indices', () => {
    const data = new Uint32Array([99, 70000, 70000, 8, 9]);
    const view = new Uint8Array(data.buffer, 4);
    expect([...expandIndexedStrip(view, 4, 0, 2)!]).toEqual([70000,70000,8,8,70000,9]);
});
test('indexed strip rejects overflow, negative and fractional ranges', () => {
    const bytes = new Uint8Array(8);
    for (const [start,count] of [[0,3],[-1,1],[0,-1],[0,1.5],[0xffffffff,1]]) {
        expect(expandIndexedStrip(bytes,2,start,count)).toBeNull();
    }
    expect(expandIndexedStrip(bytes,2,0,0)!.length).toBe(0);
});
