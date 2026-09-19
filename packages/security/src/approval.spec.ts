import { describe, expect, it } from 'vitest';
import { applyCancel, applyDecision, applyExpire, canTransition, isExpired, isTerminal, requiredApproversFor } from './approval.js';
import type { ApprovalRequest } from './approval.js';

function baseRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    approvalId: 'a1',
    actionId: 'act1',
    runId: 'run1',
    toolCallId: 'call1',
    approvalLevel: 'supervisor',
    status: 'pending',
    createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    summary: 'Reassign APP-1024',
    requiredApprovers: 1,
    approvals: [],
    ...overrides,
  };
}

describe('requiredApproversFor', () => {
  it('is 2 only for two-person, 1 for every other level', () => {
    expect(requiredApproversFor('two-person')).toBe(2);
    expect(requiredApproversFor('supervisor')).toBe(1);
    expect(requiredApproversFor('admin')).toBe(1);
    expect(requiredApproversFor('user-confirmation')).toBe(1);
  });
});

describe('canTransition', () => {
  it('allows pending to move to any resolution', () => {
    expect(canTransition('pending', 'approved')).toBe(true);
    expect(canTransition('pending', 'rejected')).toBe(true);
    expect(canTransition('pending', 'expired')).toBe(true);
    expect(canTransition('pending', 'cancelled')).toBe(true);
    expect(canTransition('pending', 'partially_approved')).toBe(true);
  });

  it('forbids any transition out of a terminal state', () => {
    for (const terminal of ['approved', 'rejected', 'expired', 'cancelled'] as const) {
      expect(canTransition(terminal, 'approved')).toBe(false);
      expect(canTransition(terminal, 'pending')).toBe(false);
    }
  });
});

describe('applyDecision - single-approver levels', () => {
  const now = new Date('2026-01-01T00:05:00.000Z');

  it('approves immediately on the first approve', () => {
    const next = applyDecision(baseRequest(), 'supervisor-1', 'approve', now);
    expect(next.status).toBe('approved');
    expect(next.approvals).toHaveLength(1);
  });

  it('rejects immediately on reject (Section 101)', () => {
    const next = applyDecision(baseRequest(), 'supervisor-1', 'reject', now, 'not needed');
    expect(next.status).toBe('rejected');
  });

  it('a decision on an already-terminal request is a no-op (Section 85)', () => {
    const approved = baseRequest({ status: 'approved' });
    const next = applyDecision(approved, 'someone-else', 'approve', now);
    expect(next).toEqual(approved);
  });
});

describe('applyDecision - two-person approval (Section 35, 105)', () => {
  const level2 = baseRequest({ approvalLevel: 'two-person', requiredApprovers: 2 });
  const now = new Date('2026-01-01T00:05:00.000Z');

  it('the first approval moves to partially_approved, not approved', () => {
    const next = applyDecision(level2, 'approver-a', 'approve', now);
    expect(next.status).toBe('partially_approved');
  });

  it('the same approver approving twice does not satisfy the requirement', () => {
    const once = applyDecision(level2, 'approver-a', 'approve', now);
    const twice = applyDecision(once, 'approver-a', 'approve', now);
    expect(twice.status).toBe('partially_approved');
    expect(twice.approvals).toHaveLength(1); // The duplicate was not recorded again.
  });

  it('a second, distinct approver completes the approval, then executes exactly once', () => {
    const once = applyDecision(level2, 'approver-a', 'approve', now);
    const twice = applyDecision(once, 'approver-b', 'approve', now);
    expect(twice.status).toBe('approved');
    expect(twice.approvals.map((a) => a.approverSubject)).toEqual(['approver-a', 'approver-b']);
  });

  it('a reject at any point during two-person rejects the whole request', () => {
    const once = applyDecision(level2, 'approver-a', 'approve', now);
    const rejected = applyDecision(once, 'approver-b', 'reject', now);
    expect(rejected.status).toBe('rejected');
  });
});

describe('expiration (Section 41, 102)', () => {
  it('isExpired is true once expiresAt has passed', () => {
    const request = baseRequest({ expiresAt: new Date('2026-01-01T00:10:00.000Z').toISOString() });
    expect(isExpired(request, new Date('2026-01-01T00:09:59.000Z'))).toBe(false);
    expect(isExpired(request, new Date('2026-01-01T00:10:00.000Z'))).toBe(true);
    expect(isExpired(request, new Date('2026-01-01T00:20:00.000Z'))).toBe(true);
  });

  it('a decision made after expiry resolves to expired, not approved/rejected', () => {
    const request = baseRequest({ expiresAt: new Date('2026-01-01T00:10:00.000Z').toISOString() });
    const next = applyDecision(request, 'supervisor-1', 'approve', new Date('2026-01-01T00:15:00.000Z'));
    expect(next.status).toBe('expired');
  });

  it('applyExpire on an already-terminal request is a no-op', () => {
    const rejected = baseRequest({ status: 'rejected' });
    expect(applyExpire(rejected)).toEqual(rejected);
  });
});

describe('cancellation (Section 42, 103)', () => {
  it('cancels a pending request, and the action can never later execute', () => {
    const next = applyCancel(baseRequest());
    expect(next.status).toBe('cancelled');
    expect(isTerminal(next.status)).toBe(true);
  });

  it('applyCancel on an already-terminal request is a no-op', () => {
    const approved = baseRequest({ status: 'approved' });
    expect(applyCancel(approved)).toEqual(approved);
  });
});
