import type { RunId, ThreadId } from '@gixcopilot/protocol';
import type { SecurityContext } from '@gixcopilot/security';

/**
 * The agent analog of `@gixcopilot/core`'s `ExecutorContext` (Section 14). Identity/security
 * comes only from the trusted runtime caller - never from model-generated arguments (Section
 * 59: delegated agents inherit trusted identity, they never receive a model-constructed one).
 */
export interface AgentExecutionContext {
  readonly runId: RunId;
  readonly agentId: string;
  readonly threadId?: ThreadId;
  readonly rootRunId?: RunId;
  readonly parentRunId?: RunId;
  /** 0 for a top-level run; incremented by one per delegation/handoff hop. */
  readonly depth: number;
  readonly securityContext: SecurityContext;
  readonly signal: AbortSignal;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
