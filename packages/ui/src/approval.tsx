import { useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ApprovalState } from '@gixcopilot/react';
import { DEFAULT_LABELS } from './labels.js';
import type { CopilotLabels } from './labels.js';

/**
 * Approval / denial / preview UI (Phase 7, Section 76-80). Built entirely on the headless
 * `useApprovals()`/`useCopilot()` contract - a custom application can build its own UI on
 * that same contract without ever using these components (Section 82's "headless approval
 * APIs... React default components cannot be mandatory").
 */
export interface ApprovalCardProps {
  readonly approval: ApprovalState;
  readonly onApprove: (approvalId: string, comment?: string) => void | Promise<void>;
  readonly onReject: (approvalId: string, comment?: string) => void | Promise<void>;
  readonly labels?: CopilotLabels;
}

/** A preview change's `before`/`after` is `unknown` - never assume it stringifies
 * meaningfully via `String()` (which would print `[object Object]` for a non-primitive). */
function displayValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '—';
  }
}

function riskLabel(approval: ApprovalState): string | undefined {
  if (!approval.risk && !approval.reversibility) return undefined;
  const parts = [approval.risk, approval.reversibility].filter(Boolean);
  return parts.join(' / ');
}

/**
 * One pending (or resolved) action awaiting/having received a human decision (Section 76-78).
 * `[Approve]`/`[Reject]` are only interactive while `status === 'pending'` - once resolved,
 * this renders the outcome instead (Section 40's "rejecting must leave the system in a safe,
 * well-defined state," reflected here as the UI never re-offering a decision already made).
 */
export function ApprovalCard({
  approval,
  onApprove,
  onReject,
  labels = DEFAULT_LABELS,
}: ApprovalCardProps): ReactElement {
  const commentId = useId();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const rejectRef = useRef<HTMLButtonElement>(null);
  const risk = riskLabel(approval);
  const isPending = approval.status === 'pending';
  useEffect(() => { if (isPending) rejectRef.current?.focus(); }, [isPending]);

  async function decide(action: (id: string, comment?: string) => void | Promise<void>): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await action(approval.approvalId, comment.trim() || undefined);
    } catch {
      setError('The decision could not be accepted. Refresh the approval or try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`gix-approval-card gix-approval-${approval.status}`}
      role={isPending ? 'alertdialog' : 'status'}
      aria-live={isPending ? 'assertive' : 'polite'}
      aria-labelledby={`${commentId}-title`}
    >
      <p id={`${commentId}-title`} className="gix-approval-title">
        {isPending ? labels.approvalTitle : approvalStatusLabel(approval.status, labels)}
      </p>
      <p className="gix-approval-summary">{approval.summary}</p>
      {risk ? (
        <p className="gix-approval-risk">
          <span className="gix-approval-risk-label">{labels.approvalRequires}</span> {approval.approvalLevel}
          {' · '}
          {risk}
        </p>
      ) : (
        <p className="gix-approval-risk">
          {labels.approvalRequires} {approval.approvalLevel}
        </p>
      )}
      {approval.preview?.summary ? <p>{approval.preview.summary}</p> : null}
      {approval.preview?.changes && approval.preview.changes.length > 0 ? (
        <div className="gix-approval-preview">
          <p className="gix-approval-preview-title">{labels.approvalPreviewTitle}</p>
          <ul>
            {approval.preview.changes.map((change) => (
              <li key={change.field}>
                <strong>{change.field}</strong>: {displayValue(change.before)} → {displayValue(change.after)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {isPending ? (
        <form
          className="gix-approval-actions"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <label className="gix-approval-comment-label" htmlFor={commentId}>
            {labels.approvalCommentPlaceholder}
          </label>
          <input
            id={commentId}
            type="text"
            className="gix-approval-comment"
            value={comment}
            disabled={busy}
            placeholder={labels.approvalCommentPlaceholder}
            onChange={(event) => setComment(event.target.value)}
          />
          <div className="gix-approval-buttons">
            <button
              type="button"
              ref={rejectRef}
              className="gix-approval-reject"
              disabled={busy}
              onClick={() => void decide(onReject)}
            >
              {labels.approvalReject}
            </button>
            <button
              type="button"
              className="gix-approval-approve"
              disabled={busy}
              onClick={() => void decide(onApprove)}
            >
              {labels.approvalApprove}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function approvalStatusLabel(status: ApprovalState['status'], labels: CopilotLabels): string {
  switch (status) {
    case 'approved':
      return labels.approvalApproved;
    case 'rejected':
      return labels.approvalRejected;
    case 'cancelled':
      return labels.stopped;
    case 'expired':
      return labels.approvalExpired;
    case 'pending':
      return labels.approvalPending;
  }
}

export interface ApprovalListProps {
  readonly approvals: readonly ApprovalState[];
  readonly onApprove: (approvalId: string, comment?: string) => void | Promise<void>;
  readonly onReject: (approvalId: string, comment?: string) => void | Promise<void>;
  readonly labels?: CopilotLabels;
}

/** Section 76's `<ApprovalHistory />`: every approval this run has seen, pending or resolved,
 * newest first - a custom UI can instead filter to `usePendingApprovals()` only. */
export function ApprovalList({
  approvals,
  onApprove,
  onReject,
  labels = DEFAULT_LABELS,
}: ApprovalListProps): ReactElement | null {
  if (approvals.length === 0) return null;
  return (
    <ul className="gix-approval-list" aria-label={labels.approvalTitle}>
      {[...approvals].reverse().map((approval) => (
        <li key={approval.approvalId}>
          <ApprovalCard approval={approval} onApprove={onApprove} onReject={onReject} labels={labels} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Section 79's denial UI - a safe, generic "not permitted" message. Never renders internal
 * policy detail (reason codes, permission names) - only what the tool-call error's public,
 * already-sanitized `message` provides (see `CopilotError.toPublicJSON()`).
 */
export function SecurityDenial({
  message,
  labels = DEFAULT_LABELS,
}: {
  readonly message: string;
  readonly labels?: CopilotLabels;
}): ReactElement {
  return (
    <div className="gix-security-denial" role="alert">
      <p className="gix-security-denial-title">{labels.denialTitle}</p>
      <p>{message}</p>
    </div>
  );
}
