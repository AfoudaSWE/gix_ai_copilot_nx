import type { PublicCopilotError } from '@gixcopilot/protocol';

/**
 * Workflow run persistence state (Section 87, 97-98) - deliberately NOT a protocol `Run`/
 * `RunStatus` (see docs/adr/0015): a workflow run is a longer-lived, pausable, resumable
 * unit of its own, not a single model turn. `'waiting_for_approval'`/`'paused'` are genuine
 * states here (unlike a protocol `Run`, which infers "paused" from an unresolved
 * `approval.requested` event) because a workflow can also be paused by an explicit developer
 * call or an external event, not only an approval wait.
 */
export type WorkflowRunStatus =
  | 'created'
  | 'running'
  | 'waiting_for_approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'dead_lettered';

export type WorkflowStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'compensated';

export interface WorkflowStepRecord {
  readonly stepId: string;
  readonly status: WorkflowStepStatus;
  readonly attempt: number;
  readonly error?: PublicCopilotError;
}

/**
 * The full durable snapshot a `CheckpointStore` persists (Section 100-104). Only structured,
 * already-validated data - never a raw secret, a live handle, or an unbounded blob (Section
 * 101, 219): a step that produces a large result should persist a reference in `state`, not
 * the payload itself.
 */
export interface WorkflowCheckpoint<TState = unknown> {
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly workflowRunId: string;
  readonly tenantId?: string;
  readonly status: WorkflowRunStatus;
  readonly state: TState;
  readonly steps: readonly WorkflowStepRecord[];
  readonly pendingApproval?: { readonly stepId: string; readonly approvalId: string };
  readonly error?: PublicCopilotError;
  /** Optimistic concurrency (Section 226-227): `save()` compares this against the currently
   * stored version and rejects a stale write with `WORKFLOW_CHECKPOINT_VERSION_MISMATCH`. */
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
