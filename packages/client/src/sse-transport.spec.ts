import { describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, createEventId, createRunId, createThreadId } from '@aicopilot/protocol';
import { createSseTransport } from './sse-transport.js';

function envelope(sequence: number) {
  return {
    id: createEventId(),
    runId: createRunId(),
    threadId: createThreadId(),
    sequence,
    timestamp: new Date().toISOString(),
    protocolVersion: PROTOCOL_VERSION,
  };
}

function sseResponse(events: readonly unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

async function drain(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const collected: unknown[] = [];
  for await (const item of iterable) {
    collected.push(item);
  }
  return collected;
}

describe('createSseTransport', () => {
  it('streams parsed events from a successful response', async () => {
    const events = [
      { ...envelope(1), type: 'run.started' },
      {
        ...envelope(2),
        type: 'run.completed',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      },
    ];
    const fetchImpl = vi.fn(() => sseResponse(events));
    const transport = createSseTransport({
      baseUrl: 'http://example.invalid',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const collected = await drain(
      transport.run({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }),
    );
    expect(collected).toEqual(events);
  });

  it('POSTs JSON to <baseUrl>/runs, including threadId only when supplied', async () => {
    const fetchImpl = vi.fn(() => sseResponse([]));
    const transport = createSseTransport({
      baseUrl: 'http://example.invalid/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await drain(
      transport.run({
        threadId: 'thread-1',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      }),
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://example.invalid/runs',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          threadId: 'thread-1',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        }),
      }),
    );
  });

  it('includes model only when supplied', async () => {
    const fetchImpl = vi.fn(() => sseResponse([]));
    const transport = createSseTransport({
      baseUrl: 'http://example.invalid',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await drain(
      transport.run({
        model: { provider: 'openai', model: 'gpt-4o-mini' },
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      }),
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://example.invalid/runs',
      expect.objectContaining({
        body: JSON.stringify({
          model: { provider: 'openai', model: 'gpt-4o-mini' },
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        }),
      }),
    );
  });

  it('throws the server-provided PublicCopilotError on a non-OK response', async () => {
    const errorBody = {
      error: { code: 'VALIDATION_ERROR', message: 'bad input', retryable: false },
    };
    const fetchImpl = vi.fn(() => new Response(JSON.stringify(errorBody), { status: 400 }));
    const transport = createSseTransport({
      baseUrl: 'http://example.invalid',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      drain(
        transport.run({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'bad input' });
  });

  it('falls back to a generic transport error when a non-OK response has no structured body', async () => {
    const fetchImpl = vi.fn(() => new Response('oops', { status: 500 }));
    const transport = createSseTransport({
      baseUrl: 'http://example.invalid',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      drain(
        transport.run({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }),
      ),
    ).rejects.toMatchObject({ code: 'TRANSPORT_ERROR' });
  });

  it('cancel() posts to the cancel endpoint and treats a 404 as success (run already finished)', async () => {
    const fetchImpl = vi.fn(() => new Response(null, { status: 404 }));
    const transport = createSseTransport({
      baseUrl: 'http://example.invalid',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(transport.cancel('some-run-id')).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith('http://example.invalid/runs/some-run-id/cancel', {
      method: 'POST',
    });
  });
});
