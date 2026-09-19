import type { ApprovalStatus } from './approval.js';

export interface AuditActor {
  readonly kind: 'user' | 'system' | 'model';
  readonly subject?: string;
}

/**
 * One audit entry (Section 63-64). Deliberately does not carry full tool
 * arguments/results by default - "do not blindly persist full sensitive inputs/results"
 * (Section 63) - only what `metadata` the caller explicitly chose to attach.
 */
export interface AuditRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly tenantId?: string;
  readonly actor: AuditActor;
  readonly action: string;
  readonly tool?: string;
  readonly runId?: string;
  readonly toolCallId?: string;
  readonly decision: string;
  readonly approval?: { readonly approvalId: string; readonly status: ApprovalStatus };
  readonly resultStatus?: 'success' | 'error' | 'denied' | 'pending';
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AuditSink {
  write(record: AuditRecord): Promise<void>;
}

export function createInMemoryAuditSink(): AuditSink & { list(): readonly AuditRecord[] } {
  const records: AuditRecord[] = [];
  return {
    write(record) {
      records.push(record);
      return Promise.resolve();
    },
    list() {
      return records.slice();
    },
  };
}

export type AuditFailureMode = 'fail-open' | 'fail-closed';

/**
 * Wraps a sink so the caller can decide, in one explicit place, what happens when audit
 * persistence itself fails (Section 66): `fail-open` logs and continues (a denied/allowed
 * action still proceeds even though it couldn't be recorded); `fail-closed` rethrows, which a
 * caller evaluating a high-risk action can use to abort the action entirely rather than let
 * it proceed unaudited. Default is `fail-open`, documented here rather than silently assumed:
 * losing an audit record for a low-risk read is rarely worth blocking the action itself, but
 * applications with stricter compliance needs should pass `fail-closed` for those actions.
 */
export function createSafeAuditSink(
  sink: AuditSink,
  mode: AuditFailureMode = 'fail-open',
  onError?: (error: unknown, record: AuditRecord) => void,
): AuditSink {
  return {
    async write(record) {
      try {
        await sink.write(record);
      } catch (error) {
        onError?.(error, record);
        if (mode === 'fail-closed') throw error;
      }
    },
  };
}
