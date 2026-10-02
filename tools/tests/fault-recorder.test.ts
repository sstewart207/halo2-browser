import { afterEach, expect, test } from 'bun:test';
import { faultRecorder, type FaultRecord } from '../../src/worker/core/memory/fault-recorder';

afterEach(() => faultRecorder.clear());

function fault(index: number): FaultRecord {
    return {
        ts: index, eip: 0x400000 + index, faultAddr: 0, errorCode: 0,
        threadId: 5, lastThunk: 'kernel32:test', kind: 'unhandled',
        regs: { ecx: 0, ebx: 0, esp: 0, ebp: 0, esi: 0, edi: 0 },
        recentCalls: [], gameEsp: 0, stackDump: [],
    };
}

test('crash-reporter fault flood preserves the original faults and the latest faults', () => {
    faultRecorder.clear();
    for (let index = 0; index < 200; index++) faultRecorder.record(fault(index));
    expect(faultRecorder.first(2).map(f => f.ts)).toEqual([0, 1]);
    expect(faultRecorder.recent(2).map(f => f.ts)).toEqual([198, 199]);
    expect(faultRecorder.first(200)).toHaveLength(64);
    expect(faultRecorder.recent(200)).toHaveLength(64);
});

test('reset clears both captures before another game run', () => {
    faultRecorder.record(fault(1));
    faultRecorder.clear();
    expect(faultRecorder.first()).toEqual([]);
    expect(faultRecorder.last()).toBeNull();
    faultRecorder.record(fault(2));
    expect(faultRecorder.first().map(f => f.ts)).toEqual([2]);
});
