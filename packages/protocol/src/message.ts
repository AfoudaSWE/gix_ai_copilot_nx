import type { MessageId, ThreadId, ToolCallId } from './ids.js';
import type { ToolResult } from './tool.js';

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * A discriminated union, additively extended in Phase 5 with the two tool content parts
 * anticipated since Phase 1 (see the original comment this replaces) - see
 * backward-compatibility's rule on additive schema evolution. No generative-UI content part
 * is implemented in Phase 5; that remains Phase 6's territory.
 *
 * - `tool_call` lives on an *assistant* message: the model asking to invoke a tool.
 * - `tool_result` lives on a *tool*-role message: the outcome fed back to the model.
 */
export type ContentPart =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'tool_call';
      readonly toolCallId: ToolCallId;
      readonly name: string;
      readonly arguments: Readonly<Record<string, unknown>>;
    }
  | { readonly type: 'tool_result'; readonly toolCallId: ToolCallId; readonly result: ToolResult };

export interface Message {
  readonly id: MessageId;
  readonly threadId: ThreadId;
  readonly role: MessageRole;
  readonly content: readonly ContentPart[];
  readonly createdAt: string;
}
