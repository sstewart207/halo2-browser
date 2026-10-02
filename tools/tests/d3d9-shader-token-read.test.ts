import {test, expect} from 'bun:test';
import {readShaderTokens} from '../../src/worker/backends/webgpu/d3d9/shader/read-tokens';
import {parseShader} from '../../src/worker/backends/webgpu/d3d9/shader/sm-parser';
const bytes = (tokens: number[]) => new Uint8Array(new Uint32Array(tokens).buffer);

test('PS2 comment END-like payload cannot truncate the executable shader', () => {
    const tokens = [0xffff0200, 0x0002fffe, 0xffffffff, 0x0000ffff, 0x02000001, 0x800f0800, 0xa0e40000, 0x0000ffff];
    const result = readShaderTokens(bytes(tokens), 0);
    expect([...result]).toEqual(tokens);
    expect(parseShader(result).instructions.length).toBe(1);
});
test('inline DEF immediate and unaligned memory views preserve shader length', () => {
    const tokens = [0xfffe0200,0x05000051,0xa00f0000,0xffffffff,0,0,0,0x0000ffff];
    const memory = new Uint8Array(tokens.length * 4 + 3);
    memory.set(bytes(tokens),3);
    expect([...readShaderTokens(memory.subarray(1),2)]).toEqual(tokens);
});
test('PS1.4 operand widths and PHASE do not confuse operands with END', () => {
    const tokens = [0xffff0104,0x42,0xb00f0000,0xb0e4ffff,0xfffd,0x1,0x800f0000,0xa0e40000,0xffff];
    expect([...readShaderTokens(bytes(tokens),0)]).toEqual(tokens);
});
test('missing END and out-of-bounds comment payload fail instead of compiling an empty shader', () => {
    expect(()=>readShaderTokens(bytes([0xffff0200,0x20fffe,0]),0)).toThrow();
    expect(()=>readShaderTokens(bytes([0xfffe0200,0]),0)).toThrow();
    expect(()=>readShaderTokens(bytes([0xffff0200,0xffff]),-1)).toThrow();
});
