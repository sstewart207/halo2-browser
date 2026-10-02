import { describe, expect, test } from 'bun:test';
import { PageTableManager, PAGE_TABLE_REGION_SIZE } from '../../src/worker/core/memory/page-table-manager';

const DIRECTORY = 0x01800000;
const TABLES = DIRECTORY + 0x1000;

describe('reserved page-table storage', () => {
    test('boot initialization preserves a Halo-sized PE image and maps all 4GB', () => {
        const memory = new Uint8Array(0x02000000);
        // Match the observed executable envelope; no proprietary fixture required.
        memory.fill(0xa5, 0x00400000, 0x01202000);
        const view = new DataView(memory.buffer);
        const manager = new PageTableManager(() => memory, () => ({}), DIRECTORY);
        manager.initialize(memory.length);
        expect(memory.subarray(0x00400000, 0x01202000).every(byte => byte === 0xa5)).toBe(true);
        expect(view.getUint32(0xe9e860, true)).toBe(0xa5a5a5a5);
        expect(view.getUint32(DIRECTORY, true)).toBe(TABLES | 7);
        expect(view.getUint32(DIRECTORY + 1023 * 4, true)).toBe((TABLES + 1023 * 0x1000) | 7);
        expect(view.getUint32(TABLES, true)).toBe(0); // NT null guard
        expect(view.getUint32(TABLES + 7 * 4, true)).toBe(0x7007);
        expect(view.getUint32(DIRECTORY + PAGE_TABLE_REGION_SIZE - 4, true)).toBe(0xfffff007);
        const cpu = { cr: new Int32Array(4) };
        manager.enablePaging(cpu);
        expect(cpu.cr[3]).toBe(DIRECTORY);
        expect(cpu.cr[0] >>> 0).toBe(0x80010000);
    });

    test('protection and recommit update relocated tables without changing adjacent game data', () => {
        const memory = new Uint8Array(0x02000000);
        const view = new DataView(memory.buffer);
        const manager = new PageTableManager(() => memory, () => ({}), DIRECTORY);
        manager.initialize(memory.length, true);
        expect(view.getUint32(TABLES, true)).toBe(7); // Win9x compatibility
        const page = 0xe9e000;
        const offset = TABLES + (page >>> 12) * 4;
        memory.fill(0xa5, page, page + 0x2000);
        manager.setProtection(page, 0x1000, 2);
        expect(view.getUint32(offset, true)).toBe(page | 5);
        manager.decommitPages(page, 0x1000);
        expect(view.getUint32(offset, true)).toBe(page | 4);
        manager.ensurePagesCommitted(page, 0x1000);
        expect(view.getUint32(offset, true)).toBe(page | 7);
        expect(view.getUint32(page, true)).toBe(0);
        expect(view.getUint32(page + 0x1000, true)).toBe(0xa5a5a5a5);
        memory[page] = 0xa5;
        manager.ensurePagesCommitted(page, 0x1000);
        expect(memory[page]).toBe(0xa5); // already committed data survives
        manager.commitPages(page, 0x1000);
        expect(memory[page]).toBe(0);
    });

    test('invalid storage fails before writing guest memory', () => {
        const memory = new Uint8Array(0x10000).fill(0xa5);
        expect(() => new PageTableManager(() => memory, () => ({}), 0x1001)).toThrow('page-aligned');
        const manager = new PageTableManager(() => memory, () => ({}), 0x1000);
        expect(() => manager.initialize(memory.length)).toThrow('exceeds guest memory');
        expect(memory.every(byte => byte === 0xa5)).toBe(true);
    });
});
