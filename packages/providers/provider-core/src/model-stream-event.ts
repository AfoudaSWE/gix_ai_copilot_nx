import type { FinishReason, PublicCopilotError, Usage } from '@gixcopilot/protocol';

/**
 * Normalized provider output. A provider adapter's only job is translating its raw SDK/API
 * stream into this shape - see the ai-runtime skill. These are NOT the same as
 * CopilotEvents: they never reach the client directly (see docs/adr/0006), they exist only
 * between a provider adapter and the model runtime.
 */
export type ModelStreamEvent =
  | { readonly type: 'model.started' }
  | { readonly type: 'content.delta'; readonly delta: string }
  | { readonly type: 'usage.updated'; readonly usage: Usage }
  | {
      readonly type: 'model.completed';
      readonly finishReason: FinishReason;
      readonly usage?: Usage;
    }
  | { readonly type: 'model.failed'; readonly error: PublicCopilotError };

export type ModelStreamEventType = ModelStreamEvent['type'];
