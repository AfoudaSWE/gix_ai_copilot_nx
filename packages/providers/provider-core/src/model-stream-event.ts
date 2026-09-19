import type { FinishReason, PublicCopilotError, Usage } from '@gixcopilot/protocol';

/**
 * Normalized provider output. A provider adapter's only job is translating its raw SDK/API
 * stream into this shape - see the ai-runtime skill. These are NOT the same as
 * CopilotEvents: they never reach the client directly (see docs/adr/0006), they exist only
 * between a provider adapter and the model runtime.
 */
/**
 * One fully-assembled tool call the model requested (Section 35, 38). A provider adapter
 * that streams tool-call arguments as fragmented deltas (e.g. OpenAI's function-calling
 * streaming shape) is responsible for assembling them into this final, parsed-JSON shape
 * before yielding it - see `assembleToolCallDeltas` for a reusable assembler. Providers that
 * only ever deliver a tool call in one chunk (e.g. `@gixcopilot/provider-mock`) can yield
 * this directly with no assembly step.
 */
export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export type ModelStreamEvent =
  | { readonly type: 'model.started' }
  | { readonly type: 'content.delta'; readonly delta: string }
  | { readonly type: 'usage.updated'; readonly usage: Usage }
  | { readonly type: 'tool_call.requested'; readonly toolCall: ModelToolCall }
  | {
      readonly type: 'model.completed';
      readonly finishReason: FinishReason;
      readonly usage?: Usage;
    }
  | { readonly type: 'model.failed'; readonly error: PublicCopilotError };

export type ModelStreamEventType = ModelStreamEvent['type'];
