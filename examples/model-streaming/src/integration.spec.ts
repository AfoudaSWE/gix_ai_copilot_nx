import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '@aicopilot/server';
import { createEchoExecutor, createRuntime } from '@aicopilot/core';
import { createModelRuntime } from '@aicopilot/provider';
import { createMockProvider } from '@aicopilot/provider-mock';
import { createCopilotClient } from '@aicopilot/client';
import type { CopilotEvent } from '@aicopilot/protocol';

async function startTestServer(): Promise<{ app: FastifyInstance; baseUrl: string }> {
  const modelRuntime = createModelRuntime({
    providers: [
      createMockProvider({
        scenario: {
          chunks: [
            'Event',
            '-driven',
            ' architecture',
            ' decouples',
            ' producers',
            ' from',
            ' consumers.',
          ],
          finishReason: 'stop',
          usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
        },
      }),
    ],
  });
  const runtime = createRuntime({ executor: createEchoExecutor() });
  const app = createServer({ runtime, modelRuntime });
  await app.listen({ port: 0, host: '127.0.0.1' });

  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected the test server to bind to a TCP address.');
  }
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

/**
 * Section 52's mandatory end-to-end mock integration test: a real client, over real HTTP,
 * to a real (in-process) server, through @aicopilot/provider's model runtime, to a
 * deterministic mock ModelProvider, streamed back as real SSE, parsed back into typed
 * events on the client. No real AI service, no credentials, nothing skippable in CI.
 */
describe('Phase 2 end-to-end (mock provider): client -> server -> core -> model runtime -> mock provider -> SSE -> client', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('delivers a correctly ordered event sequence with usage and finishReason from the model', async () => {
    const started = await startTestServer();
    app = started.app;

    const client = createCopilotClient({ baseUrl: started.baseUrl });
    const run = client.run({
      model: { provider: 'mock', model: 'mock-model' },
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Explain event-driven architecture' }] },
      ],
    });

    const events: CopilotEvent[] = [];
    for await (const event of run.events) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'message.started',
      'message.delta',
      'message.delta',
      'message.delta',
      'message.delta',
      'message.delta',
      'message.delta',
      'message.delta',
      'message.end',
      'run.completed',
    ]);
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));

    const deltas = events.filter((event) => event.type === 'message.delta');
    expect(
      deltas.map((event) => (event.type === 'message.delta' ? event.delta : undefined)),
    ).toEqual([
      'Event',
      '-driven',
      ' architecture',
      ' decouples',
      ' producers',
      ' from',
      ' consumers.',
    ]);

    const end = events.find((event) => event.type === 'message.end');
    expect(end?.type === 'message.end' && end.content).toEqual([
      { type: 'text', text: 'Event-driven architecture decouples producers from consumers.' },
    ]);

    const completed = events.at(-1);
    expect(completed?.type === 'run.completed' && completed.finishReason).toBe('stop');
    expect(completed?.type === 'run.completed' && completed.usage).toEqual({
      inputTokens: 12,
      outputTokens: 7,
      totalTokens: 19,
    });
  });

  it('cancelling a model-backed run produces run.cancelled, never run.completed', async () => {
    const modelRuntime = createModelRuntime({
      providers: [
        createMockProvider({ scenario: { chunks: ['a', 'b', 'c', 'd'], delayMsPerChunk: 30 } }),
      ],
    });
    const runtime = createRuntime({ executor: createEchoExecutor() });
    app = createServer({ runtime, modelRuntime });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Expected a TCP address');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const client = createCopilotClient({ baseUrl });
    const run = client.run({
      model: { provider: 'mock', model: 'mock-model' },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
    const iterator = run.events[Symbol.asyncIterator]() as AsyncIterator<
      CopilotEvent,
      void,
      undefined
    >;

    const first = await iterator.next();
    expect(first.value?.type).toBe('run.started');
    const runId = first.value?.runId;

    const cancelResponse = await fetch(`${baseUrl}/runs/${runId}/cancel`, { method: 'POST' });
    expect(cancelResponse.status).toBe(202);

    const rest: CopilotEvent[] = [];
    let result = await iterator.next();
    while (!result.done) {
      rest.push(result.value);
      result = await iterator.next();
    }

    expect(rest.at(-1)?.type).toBe('run.cancelled');
    expect(rest.some((event) => event.type === 'run.completed')).toBe(false);
  });

  it('a provider failure before the first chunk surfaces as run.failed with the normalized code', async () => {
    const modelRuntime = createModelRuntime({
      providers: [
        createMockProvider({
          scenario: {
            failBeforeFirstChunk: { code: 'RATE_LIMITED', message: 'slow down', retryable: false },
          },
        }),
      ],
      defaults: { retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 } },
    });
    const runtime = createRuntime({ executor: createEchoExecutor() });
    app = createServer({ runtime, modelRuntime });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Expected a TCP address');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const client = createCopilotClient({ baseUrl });
    const run = client.run({
      model: { provider: 'mock', model: 'mock-model' },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });

    const events: CopilotEvent[] = [];
    for await (const event of run.events) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'message.started',
      'run.failed',
    ]);
    const failed = events.at(-1);
    expect(failed?.type === 'run.failed' && failed.error.code).toBe('RATE_LIMITED');
  });
});
