import type { ToolActionPreview, ToolActionRisk, ToolActionReversibility, ToolApprovalLevel } from '@gixcopilot/protocol';

export type ApprovalStatus =
  | 'pending'
  | 'partially_approved'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled';

export interface ApprovalDecisionRecord {
  readonly approverSubject: string;
  readonly decision: 'approve' | 'reject';
  readonly at: string;
  readonly comment?: string;
}

/**
 * A paused action awaiting a human decision (Section 36-37, 84). First-class and persisted
 * (via `ApprovalStore`, see approval-store.ts) - never an in-memory-only suspension that a
 * process restart would silently lose (see the hitl skill's anti-pattern list).
 * `requiredApprovers` is 1 for every level except `two-person` (2, and must be two *distinct*
 * approvers - Section 35's safe default).
 */
export interface ApprovalRequest {
  readonly approvalId: string;
  readonly actionId: string;
  readonly runId: string;
  readonly toolCallId?: string;
  readonly requestedBy?: string;
  readonly tenantId?: string;
  readonly revision?: number;
  readonly approvalLevel: ToolApprovalLevel;
  readonly status: ApprovalStatus;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly summary: string;
  readonly risk?: ToolActionRisk;
  readonly reversibility?: ToolActionReversibility;
  readonly requiredPermissions?: readonly string[];
  readonly requiredApprovers: number;
  readonly approvals: readonly ApprovalDecisionRecord[];
  readonly preview?: ToolActionPreview;
}

export function requiredApproversFor(level: ToolApprovalLevel): number {
  return level === 'two-person' ? 2 : 1;
}

/** Pure transition check (Section 37) - kept separate from the store so the state machine
 * itself is trivially unit-testable without any storage concern. */
export function canTransition(from: ApprovalStatus, to: ApprovalStatus): boolean {
  const transitions: Readonly<Record<ApprovalStatus, readonly ApprovalStatus[]>> = {
    pending: ['partially_approved', 'approved', 'rejected', 'expired', 'cancelled'],
    partially_approved: ['approved', 'rejected', 'expired', 'cancelled'],
    approved: [],
    rejected: [],
    expired: [],
    cancelled: [],
  };
  return transitions[from].includes(to);
}

export function isTerminal(status: ApprovalStatus): boolean {
  return status === 'approved' || status === 'rejected' || status === 'expired' || status === 'cancelled';
}

export function isExpired(request: ApprovalRequest, now: Date): boolean {
  return request.expiresAt !== undefined && new Date(request.expiresAt).getTime() <= now.getTime();
}

/**
 * Applies one approver's decision (Section 33-37, 85-86). Idempotent: the same approver
 * approving/rejecting an already-terminal request, or approving twice, does not change the
 * outcome or double-count (Section 85, 105 - "the same identity approving twice does not
 * satisfy [two-person]"). Returns the request unchanged (not an error) when the decision is a
 * genuine no-op, so a duplicate button click is always safe.
 */
export function applyDecision(
  request: ApprovalRequest,
  approverSubject: string,
  decision: 'approve' | 'reject',
  now: Date,
  comment?: string,
): ApprovalRequest {
  if (isTerminal(request.status)) return request;
  if (isExpired(request, now)) {
    return { ...request, status: 'expired' };
  }

  if (decision === 'reject') {
    return {
      ...request,
      status: 'rejected',
      approvals: [
        ...request.approvals,
        { approverSubject, decision, at: now.toISOString(), ...(comment !== undefined ? { comment } : {}) },
      ],
    };
  }

  const alreadyApprovedByThisSubject = request.approvals.some(
    (record) => record.approverSubject === approverSubject && record.decision === 'approve',
  );
  if (alreadyApprovedByThisSubject) return request; // Duplicate approve - no-op (Section 85).

  const approvals: readonly ApprovalDecisionRecord[] = [
    ...request.approvals,
    { approverSubject, decision, at: now.toISOString(), ...(comment !== undefined ? { comment } : {}) },
  ];
  const distinctApprovers = new Set(
    approvals.filter((record) => record.decision === 'approve').map((record) => record.approverSubject),
  ).size;

  const status: ApprovalStatus =
    distinctApprovers >= request.requiredApprovers ? 'approved' : 'partially_approved';
  return { ...request, status, approvals };
}

export function applyExpire(request: ApprovalRequest): ApprovalRequest {
  if (isTerminal(request.status)) return request;
  return { ...request, status: 'expired' };
}

export function applyCancel(request: ApprovalRequest): ApprovalRequest {
  if (isTerminal(request.status)) return request;
  return { ...request, status: 'cancelled' };
}
