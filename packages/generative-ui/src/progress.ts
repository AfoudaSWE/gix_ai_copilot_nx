/**
 * Progress rendering (Section 50-52) is deliberately built as a pure projection of the
 * *existing* tool-call lifecycle (Phase 5's `tool.requested`/`started`/`completed`/`failed`
 * events, already surfaced client-side as `ToolCallState[]`) rather than a new event
 * family - Section 52 explicitly asks to "avoid excessive event proliferation" and "reuse
 * existing events where possible". This module knows nothing about React or the wire
 * protocol; it only shapes an already-decoded list of tool-call-shaped activity into
 * `ProgressStep`s, so it is equally usable by the React adapter and, later, by a Phase 10
 * agent runtime describing its own step-by-step activity the same way (Section 90).
 */
export type ProgressStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ProgressStep {
  readonly id: string;
  readonly label: string;
  readonly status: ProgressStepStatus;
}

/** The minimal shape this module needs from a tool-call-like activity entry. */
export interface ToolActivityLike {
  readonly id: string;
  readonly name: string;
  readonly status: 'requested' | 'running' | 'succeeded' | 'failed';
}

const STATUS_MAP: Readonly<Record<ToolActivityLike['status'], ProgressStepStatus>> = {
  requested: 'pending',
  running: 'running',
  succeeded: 'completed',
  failed: 'failed',
};

export interface ToProgressStepsOptions {
  /** Overrides the default (the activity's own `name`) with a friendlier label. */
  readonly labelOf?: (activity: ToolActivityLike) => string;
}

export function toProgressSteps(
  activity: readonly ToolActivityLike[],
  options: ToProgressStepsOptions = {},
): readonly ProgressStep[] {
  return activity.map((entry) => ({
    id: entry.id,
    label: options.labelOf?.(entry) ?? entry.name,
    status: STATUS_MAP[entry.status],
  }));
}
