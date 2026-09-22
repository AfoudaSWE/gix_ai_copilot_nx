import type { RunId, ThreadId } from './ids.js';
import type { ProtocolVersion } from './version.js';
import type { Usage } from './usage.js';

/**
 * Run lifecycle states. @gixcopilot/core owns the state machine that enforces valid
 * transitions between these; this package only defines the shape.
 */
export type RunStatus = 'created' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Run {
  readonly id: RunId;
  readonly threadId: ThreadId;
  readonly status: RunStatus;
  readonly protocolVersion: ProtocolVersion;
  readonly createdAt: string;
  readonly usage: Usage;
  /**
   * Ancestry, added in Phase 10 (agents/workflows) - optional so every Phase 1-9 run (which
   * has no parent) keeps working unmodified. `rootRunId` is the top-level run that started a
   * delegation/handoff/workflow-agent-step chain; `parentRunId` is this run's immediate
   * caller. Both are absent for a top-level run. See the agent-architecture skill's
   * requirement that nested execution be traceable.
   */
  readonly rootRunId?: RunId;
  readonly parentRunId?: RunId;
}
