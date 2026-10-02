import { expect, test } from 'bun:test';
import { SyncObjectManager } from '../../src/worker/core/scheduler/sync-objects';
import { SystemResourceProvider } from '../../src/worker/core/resources/system-resource-provider';
import { ThreadState, WAIT_OBJECT_0 } from '../../src/worker/core/scheduler/types';

test('terminated thread handles stay signaled after the scheduler reaps the thread', () => {
    const provider = SystemResourceProvider.getInstance();
    const handle = provider.registerKernelObject({ kind: 'thread', threadId: 7, terminated: true, exitCode: 0 });
    const sync = new SyncObjectManager();
    try {
        const reaped = () => null;
        expect(sync.isSignaled(handle, 1, reaped)).toBe(true);
        expect(sync.checkWait([handle], false, 1, reaped)).toMatchObject({ ready: true, result: WAIT_OBJECT_0 });
        expect(sync.checkWait([handle], true, 1, reaped)).toMatchObject({ ready: true, result: WAIT_OBJECT_0 });
        sync.consumeWait(sync.checkWait([handle], false, 1, reaped), 1);
        expect(sync.isSignaled(handle, 1, reaped)).toBe(true); // Thread handles do not auto-reset.
    } finally { provider.unregisterKernelObject(handle); }
});

test('missing live thread records alone do not imply termination', () => {
    const provider = SystemResourceProvider.getInstance();
    const handle = provider.registerKernelObject({ kind: 'thread', threadId: 7 });
    const sync = new SyncObjectManager();
    try {
        expect(sync.isSignaled(handle, 1, () => null)).toBe(false);
        expect(sync.checkWait([handle], false, 1, () => null).ready).toBe(false);
        expect(sync.checkWait([handle], true, 1, () => null).ready).toBe(false);
        expect(sync.isSignaled(handle, 1, () => ({ state: ThreadState.TERMINATED }))).toBe(true);
    } finally { provider.unregisterKernelObject(handle); }
});
