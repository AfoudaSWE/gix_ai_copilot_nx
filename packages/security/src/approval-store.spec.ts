import { describe, expect, it } from 'vitest';
import { createInMemoryApprovalStore } from './approval-store.js';

function input(overrides: Partial<Parameters<ReturnType<typeof createInMemoryApprovalStore>['create']>[0]> = {}) {
  return {
    approvalId: 'a1',
    actionId: 'act1',
    runId: 'run1',
    toolCallId: 'call1',
    approvalLevel: 'supervisor' as const,
    summary: 'Reassign APP-1024',
    ...overrides,
  };
}

describe('createInMemoryApprovalStore', () => {
  it('creates a pending request and get() returns it', async () => {
    const store = createInMemoryApprovalStore();
    const created = await store.create(input());
    expect(created.status).toBe('pending');
    expect(await store.get('a1')).toEqual(created);
  });

  it('approve/reject mutate status via the same state machine rules', async () => {
    const store = createInMemoryApprovalStore();
    await store.create(input());
    const approved = await store.approve('a1', 'supervisor-1');
    expect(approved.status).toBe('approved');
  });

  it('rejects the promise for an unknown approvalId', async () => {
    const store = createInMemoryApprovalStore();
    await expect(store.get('missing')).resolves.toBeUndefined();
    await expect(store.approve('missing', 'x')).rejects.toThrow();
  });

  it('awaitDecision resolves once approve() is called (the run-pausing mechanism, Section 38-39)', async () => {
    const store = createInMemoryApprovalStore();
    await store.create(input());
    const waiting = store.awaitDecision('a1');
    await store.approve('a1', 'supervisor-1');
    const resolved = await waiting;
    expect(resolved.status).toBe('approved');
  });

  it('awaitDecision resolves immediately for an already-terminal request', async () => {
    const store = createInMemoryApprovalStore();
    await store.create(input());
    await store.reject('a1', 'supervisor-1');
    const resolved = await store.awaitDecision('a1');
    expect(resolved.status).toBe('rejected');
  });

  it('awaitDecision rejects when its signal aborts (Section 42 - cancelling the run while pending)', async () => {
    const store = createInMemoryApprovalStore();
    await store.create(input());
    const controller = new AbortController();
    const waiting = store.awaitDecision('a1', { signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toThrow();
    // The approval itself is not silently left dangling - the caller is expected to also
    // cancel() it; verify cancel() still works after the aborted wait.
    const cancelled = await store.cancel('a1');
    expect(cancelled.status).toBe('cancelled');
  });

  it('an approval expires on its own after expiresInMs elapses, waking any awaiter (Section 102)', async () => {
    const store = createInMemoryApprovalStore();
    await store.create(input({ expiresInMs: 20 }));
    const resolved = await store.awaitDecision('a1');
    expect(resolved.status).toBe('expired');
  }, 2000);

  it('list() filters by status and runId', async () => {
    const store = createInMemoryApprovalStore();
    await store.create(input({ approvalId: 'a1', runId: 'run1' }));
    await store.create(input({ approvalId: 'a2', runId: 'run2' }));
    await store.approve('a1', 'supervisor-1');

    expect((await store.list({ status: 'approved' })).map((r) => r.approvalId)).toEqual(['a1']);
    expect((await store.list({ runId: 'run2' })).map((r) => r.approvalId)).toEqual(['a2']);
  });

  it('two-person: awaitDecision only resolves once both distinct approvers have approved', async () => {
    const store = createInMemoryApprovalStore();
    await store.create(input({ approvalLevel: 'two-person' }));
    const waiting = store.awaitDecision('a1');

    await store.approve('a1', 'approver-a');
    let settled = false;
    void waiting.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);

    await store.approve('a1', 'approver-b');
    const resolved = await waiting;
    expect(resolved.status).toBe('approved');
  });
});
