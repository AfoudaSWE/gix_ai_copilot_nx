import { describe, expect, it, vi } from 'vitest';
import { createOpenAIProvider } from './openai-provider.js';
import type { ModelStreamEvent } from '@gixcopilot/provider';

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function chatChunk(overrides: {
  delta?: { content?: string };
  finish_reason?: string | null;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
}): unknown {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 1_700_000_000,
    model: 'gpt-4o-mini',
    choices:
      overrides.delta || overrides.finish_reason !== undefined
        ? [
            {
              index: 0,
              delta: overrides.delta ?? {},
              finish_reason: overrides.finish_reason ?? null,
            },
          ]
        : [],
    ...(overrides.usage !== undefined ? { usage: overrides.usage } : {}),
  };
}

function sseResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    ...init,
  });
}

function errorResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function collect(iterable: AsyncIterable<ModelStreamEvent>): Promise<ModelStreamEvent[]> {
  const collected: ModelStreamEvent[] = [];
  for await (const event of iterable) {
    collected.push(event);
  }
  return collected;
}

describe('createOpenAIProvider', () => {
  it('maps a streamed response into content.delta / usage.updated / model.completed', async () => {
    const body =
      sseChunk(chatChunk({ delta: { content: 'Hello' } })) +
      sseChunk(chatChunk({ delta: { content: ' world' } })) +
      sseChunk(chatChunk({ finish_reason: 'stop' })) +
      sseChunk(chatChunk({ usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } })) +
      'data: [DONE]\n\n';

    const fakeFetch = vi.fn(() => sseResponse(body));
    const provider = createOpenAIProvider({
      apiKey: 'test-key',
      fetch: fakeFetch as unknown as typeof fetch,
    });

    const events = await collect(
      provider.stream({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      }),
    );

    expect(events.map((e) => e.type)).toEqual([
      'model.started',
      'content.delta',
      'content.delta',
      'usage.updated',
      'model.completed',
    ]);
    expect(
      events
        .filter((e) => e.type === 'content.delta')
        .map((e) => (e.type === 'content.delta' ? e.delta : '')),
    ).toEqual(['Hello', ' world']);
    const completed = events.at(-1);
    expect(completed?.type === 'model.completed' && completed.finishReason).toBe('stop');
    expect(completed?.type === 'model.completed' && completed.usage).toEqual({
      inputTokens: 5,
      outputTokens: 2,
      totalTokens: 7,
    });
  });

  it('maps a 401 response to AUTHENTICATION_ERROR', async () => {
    const fakeFetch = vi.fn(() =>
      errorResponse(401, { error: { message: 'Invalid API key', type: 'invalid_request_error' } }),
    );
    const provider = createOpenAIProvider({
      apiKey: 'bad-key',
      fetch: fakeFetch as unknown as typeof fetch,
    });

    const events = await collect(provider.stream({ model: 'gpt-4o-mini', messages: [] }));
    expect(events.map((e) => e.type)).toEqual(['model.started', 'model.failed']);
    const failed = events.at(-1);
    expect(failed?.type === 'model.failed' && failed.error.code).toBe('AUTHENTICATION_ERROR');
    expect(failed?.type === 'model.failed' && failed.error.retryable).toBe(false);
  });

  it('maps a 429 response to RATE_LIMITED (retryable)', async () => {
    const fakeFetch = vi.fn(() =>
      errorResponse(429, { error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } }),
    );
    const provider = createOpenAIProvider({
      apiKey: 'test-key',
      fetch: fakeFetch as unknown as typeof fetch,
    });

    const events = await collect(provider.stream({ model: 'gpt-4o-mini', messages: [] }));
    const failed = events.at(-1);
    expect(failed?.type === 'model.failed' && failed.error.code).toBe('RATE_LIMITED');
    expect(failed?.type === 'model.failed' && failed.error.retryable).toBe(true);
  });

  it('maps a context_length_exceeded 400 response to CONTEXT_LIMIT_EXCEEDED', async () => {
    const fakeFetch = vi.fn(() =>
      errorResponse(400, {
        error: {
          message: 'context length exceeded',
          type: 'invalid_request_error',
          code: 'context_length_exceeded',
        },
      }),
    );
    const provider = createOpenAIProvider({
      apiKey: 'test-key',
      fetch: fakeFetch as unknown as typeof fetch,
    });

    const events = await collect(provider.stream({ model: 'gpt-4o-mini', messages: [] }));
    const failed = events.at(-1);
    expect(failed?.type === 'model.failed' && failed.error.code).toBe('CONTEXT_LIMIT_EXCEEDED');
  });

  it('maps a 404 response to MODEL_NOT_FOUND', async () => {
    const fakeFetch = vi.fn(() =>
      errorResponse(404, {
        error: { message: 'The model does not exist', type: 'invalid_request_error' },
      }),
    );
    const provider = createOpenAIProvider({
      apiKey: 'test-key',
      fetch: fakeFetch as unknown as typeof fetch,
    });

    const events = await collect(provider.stream({ model: 'no-such-model', messages: [] }));
    const failed = events.at(-1);
    expect(failed?.type === 'model.failed' && failed.error.code).toBe('MODEL_NOT_FOUND');
  });

  it('maps a 500 response to a retryable PROVIDER_ERROR', async () => {
    const fakeFetch = vi.fn(() =>
      errorResponse(500, { error: { message: 'Internal server error', type: 'server_error' } }),
    );
    const provider = createOpenAIProvider({
      apiKey: 'test-key',
      fetch: fakeFetch as unknown as typeof fetch,
    });

    const events = await collect(provider.stream({ model: 'gpt-4o-mini', messages: [] }));
    const failed = events.at(-1);
    expect(failed?.type === 'model.failed' && failed.error.code).toBe('PROVIDER_ERROR');
    expect(failed?.type === 'model.failed' && failed.error.retryable).toBe(true);
  });

  it('rejects a tool-role message with no tool_result content part before ever calling the API', async () => {
    const fakeFetch = vi.fn();
    const provider = createOpenAIProvider({
      apiKey: 'test-key',
      fetch: fakeFetch as unknown as typeof fetch,
    });

    const events = await collect(
      provider.stream({
        model: 'gpt-4o-mini',
        messages: [{ role: 'tool', content: [{ type: 'text', text: 'result' }] }],
      }),
    );

    const failed = events.at(-1);
    expect(failed?.type === 'model.failed' && failed.error.code).toBe('VALIDATION_ERROR');
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  describe('Phase 5 tool calling', () => {
    it('sends the request tools mapped to OpenAI function-calling shape', async () => {
      const fakeFetch = vi.fn(() => sseResponse('data: [DONE]\n\n'));
      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        fetch: fakeFetch as unknown as typeof fetch,
      });

      await collect(
        provider.stream({
          model: 'gpt-4o-mini',
          messages: [],
          tools: [
            {
              name: 'applications.getStatus',
              description: 'Get status',
              parameters: { type: 'object', properties: {} },
            },
          ],
        }),
      );

      const call = fakeFetch.mock.calls[0] as [string, { body?: string }] | undefined;
      const body = call?.[1]?.body ? (JSON.parse(call[1].body) as Record<string, unknown>) : {};
      expect(body['tools']).toEqual([
        {
          type: 'function',
          function: {
            name: 'applications.getStatus',
            description: 'Get status',
            parameters: { type: 'object', properties: {} },
          },
        },
      ]);
    });

    it('omits the tools field entirely when no tools are supplied', async () => {
      const fakeFetch = vi.fn(() => sseResponse('data: [DONE]\n\n'));
      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        fetch: fakeFetch as unknown as typeof fetch,
      });
      await collect(provider.stream({ model: 'gpt-4o-mini', messages: [] }));
      const call = fakeFetch.mock.calls[0] as [string, { body?: string }] | undefined;
      const body = call?.[1]?.body ? (JSON.parse(call[1].body) as Record<string, unknown>) : {};
      expect(body).not.toHaveProperty('tools');
    });

    it('assembles fragmented streamed tool-call argument deltas into a single tool_call.requested event', async () => {
      const body =
        sseChunk({
          id: 'x',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', type: 'function', function: { name: 'math.add', arguments: '' } },
                ],
              },
              finish_reason: null,
            },
          ],
        }) +
        sseChunk({
          id: 'x',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":1,' } }] },
              finish_reason: null,
            },
          ],
        }) +
        sseChunk({
          id: 'x',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, function: { arguments: '"b":2}' } }] },
              finish_reason: 'tool_calls',
            },
          ],
        }) +
        'data: [DONE]\n\n';

      const fakeFetch = vi.fn(() => sseResponse(body));
      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        fetch: fakeFetch as unknown as typeof fetch,
      });

      const events = await collect(provider.stream({ model: 'gpt-4o-mini', messages: [] }));
      expect(events.map((e) => e.type)).toEqual([
        'model.started',
        'tool_call.requested',
        'model.completed',
      ]);
      const toolCallEvent = events.find((e) => e.type === 'tool_call.requested');
      expect(toolCallEvent?.type === 'tool_call.requested' && toolCallEvent.toolCall).toEqual({
        id: 'call_1',
        name: 'math.add',
        arguments: { a: 1, b: 2 },
      });
      const completed = events.at(-1);
      expect(completed?.type === 'model.completed' && completed.finishReason).toBe('tool_calls');
    });
  });

  it('propagates the abort signal to the underlying fetch call', async () => {
    let observedSignal: AbortSignal | null | undefined;
    const fakeFetch = vi.fn((_url: string, init?: { signal?: AbortSignal | null }) => {
      observedSignal = init?.signal;
      return sseResponse('data: [DONE]\n\n');
    });
    const provider = createOpenAIProvider({
      apiKey: 'test-key',
      fetch: fakeFetch as unknown as typeof fetch,
    });

    const controller = new AbortController();
    await collect(
      provider.stream({ model: 'gpt-4o-mini', messages: [] }, { signal: controller.signal }),
    );

    expect(observedSignal).toBeTruthy();
  });

  it('uses "openai" as the default id, and honors a custom id', () => {
    expect(createOpenAIProvider({ apiKey: 'test-key' }).id).toBe('openai');
    expect(createOpenAIProvider({ apiKey: 'test-key', id: 'openai-eu' }).id).toBe('openai-eu');
  });
});
