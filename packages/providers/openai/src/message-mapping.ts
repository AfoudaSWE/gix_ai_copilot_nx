import { CopilotError } from '@aicopilot/protocol';
import type { ModelMessage } from '@aicopilot/provider';
import type OpenAI from 'openai';

function textOf(message: ModelMessage): string {
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

/** Converts one provider-neutral ModelMessage into OpenAI's own chat message shape (Section 12). */
export function toOpenAIMessage(message: ModelMessage): OpenAI.ChatCompletionMessageParam {
  const content = textOf(message);
  switch (message.role) {
    case 'system':
      return { role: 'system', content };
    case 'user':
      return { role: 'user', content };
    case 'assistant':
      return { role: 'assistant', content };
    case 'tool':
      throw CopilotError.validation(
        'Tool-role messages are not supported by this provider until Phase 5 (tool calling).',
      );
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
