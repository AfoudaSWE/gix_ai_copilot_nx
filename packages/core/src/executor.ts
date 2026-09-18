import type {
  ContentPart,
  FinishReason,
  MessageRole,
  RunId,
  ThreadId,
  Usage,
} from '@gixcopilot/protocol';

export interface ExecutorMessageInput {
  readonly role: MessageRole;
  readonly content: readonly ContentPart[];
}

export interface ExecutorInput {
  readonly threadId: ThreadId;
  /**
   * The full conversation so far (not just the latest turn) - added in Phase 2 so a model
   * executor has the history it needs. A run still produces exactly one assistant reply.
   */
  readonly messages: readonly ExecutorMessageInput[];
}

export interface ExecutorContext {
  readonly runId: RunId;
  /** Aborts when the run is cancelled. Implementations must stop yielding promptly. */
  readonly signal: AbortSignal;
}

/**
 * Optional metadata an Executor can report once it's done producing deltas, surfaced on
 * the run's `run.completed` event. Both fields are optional and default to "unknown" (empty
 * usage, no finish reason) - see runtime.ts - so a Phase 1-style executor that returns
 * nothing keeps working unmodified.
 */
export interface ExecutorCompletion {
  readonly usage?: Usage;
  readonly finishReason?: FinishReason;
}

/**
 * The generic run/execution boundary Phase 1 establishes. Deliberately has no notion of a
 * model, a prompt, or a provider - see the ai-runtime skill for where that abstraction
 * belongs. An Executor's only job is: given the conversation so far, stream the assistant's
 * reply as text deltas (honoring cancellation), optionally reporting usage/finish-reason
 * metadata when it naturally finishes.
 *
 * `@gixcopilot/provider`'s `createModelExecutor` is the Phase 2 implementation of this
 * interface backed by a real (or mock) LLM; `createEchoExecutor` remains the deterministic,
 * non-AI reference implementation.
 */
export interface Executor {
  execute(
    input: ExecutorInput,
    context: ExecutorContext,
  ): AsyncGenerator<string, ExecutorCompletion | void, undefined>;
}
