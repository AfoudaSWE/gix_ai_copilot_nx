import type { ContentPart, MessageRole } from '@aicopilot/protocol';

/**
 * A provider-neutral chat message. Reuses protocol's MessageRole/ContentPart rather than
 * inventing a parallel shape - see docs/adr/0006-model-provider-abstraction.md. Phase 2
 * only needs text content (no tool calls, no multimodal) - see the ai-runtime skill.
 */
export interface ModelMessage {
  readonly role: MessageRole;
  readonly content: readonly ContentPart[];
}
