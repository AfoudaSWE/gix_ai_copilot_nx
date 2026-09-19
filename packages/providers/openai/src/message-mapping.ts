import { CopilotError } from '@gixcopilot/protocol';
import type { ModelMessage } from '@gixcopilot/provider';
import type OpenAI from 'openai';

function textOf(message: ModelMessage): string {
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

/**
 * Converts one provider-neutral ModelMessage into OpenAI's own chat message shape (Section
 * 12, extended in Phase 5 for tool calling). An assistant message carrying `tool_call`
 * content parts maps to OpenAI's `tool_calls` field; a `tool`-role message (previously
 * rejected outright, see the Phase 2 comment this replaces) maps to OpenAI's own `tool`
 * message shape, keyed by `tool_call_id`.
 */
export function toOpenAIMessage(message: ModelMessage): OpenAI.ChatCompletionMessageParam {
  switch (message.role) {
    case 'system':
      return { role: 'system', content: textOf(message) };
    case 'user':
      return { role: 'user', content: textOf(message) };
    case 'assistant': {
      const toolCallParts = message.content.filter((part) => part.type === 'tool_call');
      if (toolCallParts.length === 0) {
        return { role: 'assistant', content: textOf(message) };
      }
      return {
        role: 'assistant',
        content: textOf(message) || null,
        tool_calls: toolCallParts.map((part) => ({
          id: part.toolCallId,
          type: 'function',
          function: { name: part.name, arguments: JSON.stringify(part.arguments) },
        })),
      };
    }
    case 'tool': {
      const resultPart = message.content.find((part) => part.type === 'tool_result');
      if (!resultPart) {
        throw CopilotError.validation(
          'A tool-role message must contain exactly one tool_result content part.',
        );
      }
      const payload =
        resultPart.result.status === 'success'
          ? resultPart.result.data
          : { error: resultPart.result.error };
      return {
        role: 'tool',
        tool_call_id: resultPart.toolCallId,
        content: JSON.stringify(payload ?? null),
      };
    }
    default: {
      const exhaustive: never = message.role;
      throw new Error(`Unhandled message role: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function toOpenAIMessages(
  messages: readonly ModelMessage[],
): OpenAI.ChatCompletionMessageParam[] {
  return messages.map(toOpenAIMessage);
}
