import { describe, expect, it } from 'vitest';
import { toOpenAIMessage } from './message-mapping.js';

describe('toOpenAIMessage', () => {
  it('maps plain text messages for system/user/assistant unchanged', () => {
    expect(toOpenAIMessage({ role: 'user', content: [{ type: 'text', text: 'hi' }] })).toEqual({
      role: 'user',
      content: 'hi',
    });
    expect(
      toOpenAIMessage({ role: 'system', content: [{ type: 'text', text: 'be helpful' }] }),
    ).toEqual({ role: 'system', content: 'be helpful' });
  });

  it('maps an assistant message carrying a tool_call content part to OpenAI tool_calls', () => {
    const mapped = toOpenAIMessage({
      role: 'assistant',
      content: [
        {
          type: 'tool_call',
          toolCallId: 'call-1',
          name: 'applications.getStatus',
          arguments: { applicationId: 'APP-1024' },
        },
      ],
    });
    expect(mapped).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'applications.getStatus',
            arguments: JSON.stringify({ applicationId: 'APP-1024' }),
          },
        },
      ],
    });
  });

  it('preserves accompanying assistant text alongside a tool_call part', () => {
    const mapped = toOpenAIMessage({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me check that.' },
        { type: 'tool_call', toolCallId: 'call-1', name: 'x', arguments: {} },
      ],
    });
    expect(mapped).toMatchObject({ role: 'assistant', content: 'Let me check that.' });
  });

  it('maps a successful tool_result to an OpenAI tool message keyed by tool_call_id', () => {
    const mapped = toOpenAIMessage({
      role: 'tool',
      content: [
        {
          type: 'tool_result',
          toolCallId: 'call-1',
          result: { status: 'success', toolCallId: 'call-1', data: { status: 'PENDING' } },
        },
      ],
    });
    expect(mapped).toEqual({
      role: 'tool',
      tool_call_id: 'call-1',
      content: JSON.stringify({ status: 'PENDING' }),
    });
  });

  it('maps a failed tool_result to a tool message carrying the error', () => {
    const mapped = toOpenAIMessage({
      role: 'tool',
      content: [
        {
          type: 'tool_result',
          toolCallId: 'call-1',
          result: {
            status: 'error',
            toolCallId: 'call-1',
            error: { code: 'TOOL_EXECUTION_ERROR', message: 'boom', retryable: false },
          },
        },
      ],
    });
    expect(mapped).toEqual({
      role: 'tool',
      tool_call_id: 'call-1',
      content: JSON.stringify({
        error: { code: 'TOOL_EXECUTION_ERROR', message: 'boom', retryable: false },
      }),
    });
  });

  it('rejects a tool-role message with no tool_result content part', () => {
    expect(() =>
      toOpenAIMessage({ role: 'tool', content: [{ type: 'text', text: 'oops' }] }),
    ).toThrow(/tool_result content part/);
  });
});
