import type { ContentPart, MessageRole, RunId, ThreadId } from '@aicopilot/protocol';

export interface ExecutorMessageInput {
  readonly role: MessageRole;
  readonly content: readonly ContentPart[];
}

export interface ExecutorInput {
  readonly threadId: ThreadId;
  readonly message: ExecutorMessageInput;
}

export interface ExecutorContext {
  readonly runId: RunId;
  /** Aborts when the run is cancelled. Implementations must stop yielding promptly. */
  readonly signal: AbortSignal;
}

/**
 * The generic run/execution boundary Phase 1 establishes. Deliberately has no notion of a
 * model, a prompt, or a provider - see the ai-runtime skill for where that abstraction
 * belongs once Phase 2 introduces an LLM runtime. An Executor's only job is: given one
 * input message, stream the assistant's reply as text deltas, honoring cancellation.
 */
export interface Executor {
  execute(input: ExecutorInput, context: ExecutorContext): AsyncIterable<string>;
}
