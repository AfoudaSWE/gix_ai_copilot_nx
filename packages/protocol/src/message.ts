import type { MessageId, ThreadId } from './ids.js';

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * A discriminated union with a single variant today. Kept as a union (not a bare string
 * field) so later phases can add variants (e.g. a tool-call or generative-UI content part)
 * additively without breaking existing consumers that switch exhaustively on `type` -
 * see backward-compatibility's rule on additive schema evolution. No tool/UI content part
 * is implemented in Phase 1.
 */
export type ContentPart = { readonly type: 'text'; readonly text: string };

export interface Message {
  readonly id: MessageId;
  readonly threadId: ThreadId;
  readonly role: MessageRole;
  readonly content: readonly ContentPart[];
  readonly createdAt: string;
}
