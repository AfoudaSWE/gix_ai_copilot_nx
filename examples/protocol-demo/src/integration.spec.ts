import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '@aicopilot/server';
import { createEchoExecutor, createRuntime } from '@aicopilot/core';
import { createCopilotClient } from '@aicopilot/client';
import type { CopilotEvent } from '@aicopilot/protocol';

async function startTestServer(
  delayMsPerChunk = 0,
): Promise<{ app: FastifyInstance; baseUrl: string }> {
  const runtime = createRuntime({ executor: createEchoExecutor({ delayMsPerChunk }) });
  const app = createServer({ runtime });
  await app.listen({ port: 0, host: '127.0.0.1' });

  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected the test server to bind to a TCP address.');
  }
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

/**
 * This is the Phase 1 "Required End-to-End Demonstration" as an automated test: a real
 * client, over real HTTP, to a real (in-process) server, driving @aicopilot/core's runtime,
 * streamed back as real Server-Sent Events, parsed back into typed events on the client.
 * No LLM, no provider SDK, no network call to any external AI service - only the
 * deterministic echo executor from @aicopilot/core.
 */
describe('Phase 1 end-to-end: client -> HTTP -> server -> core -> SSE -> client', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('delivers a correctly ordered, fully-typed event sequence with no external AI dependency', async () => {
    const started = await startTestServer();
    app = started.app;

    const client = createCopilotClient({ baseUrl: started.baseUrl });
    const run = client.run({
      message: { role: 'user', content: [{ type: 'text', text: 'Hello protocol' }] },
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
      'message.end',
      'run.completed',
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(events.map((event) => event.runId)).size).toBe(1);

    const deltas = events.filter((event) => event.type === 'message.delta');
    expect(
      deltas.map((event) => (event.type === 'message.delta' ? event.delta : undefined)),
    ).toEqual(['Hello', ' ', 'protocol']);

    const end = events.find((event) => event.type === 'message.end');
    expect(end?.type === 'message.end' && end.content).toEqual([
      { type: 'text', text: 'Hello protocol' },
    ]);
  });

  it('client-side run.cancel() tears down the connection before the run ever completes', async () => {
    const started = await startTestServer(50);
    app = started.app;

    const client = createCopilotClient({ baseUrl: started.baseUrl });
    const run = client.run({
      message: { role: 'user', content: [{ type: 'text', text: 'Hello protocol' }] },
    });
    const iterator = run.events[Symbol.asyncIterator]() as AsyncIterator<
      CopilotEvent,
      void,
      undefined
    >;

    const first = await iterator.next();
    expect(first.value?.type).toBe('run.started');

    run.cancel();

    // Cancellation stops future data, but bytes already buffered in flight before the abort
    // took effect may still be delivered - it does not retroactively discard them. What
    // matters is that the run never reaches completion once cancelled.
    const rest: CopilotEvent[] = [];
    let result = await iterator.next();
    while (!result.done) {
      rest.push(result.value);
      result = await iterator.next();
    }

    expect(rest.every((event) => event.type !== 'run.completed')).toBe(true);
  });

  it('out-of-band POST /runs/:runId/cancel stops an in-flight run and the client observes run.cancelled', async () => {
    const started = await startTestServer(150);
    app = started.app;

    const client = createCopilotClient({ baseUrl: started.baseUrl });
    const run = client.run({
      message: { role: 'user', content: [{ type: 'text', text: 'Hello protocol' }] },
    });
    const iterator = run.events[Symbol.asyncIterator]() as AsyncIterator<
      CopilotEvent,
      void,
      undefined
    >;

    const first = await iterator.next();
    expect(first.value?.type).toBe('run.started');
    const runId = first.value?.runId;
    expect(runId).toBeTruthy();

    const cancelResponse = await fetch(`${started.baseUrl}/runs/${runId}/cancel`, {
      method: 'POST',
    });
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

  it('a second cancel against an id with no in-flight run reports 404, matching direct server behavior', async () => {
    const started = await startTestServer();
    app = started.app;

    const response = await fetch(`${started.baseUrl}/runs/never-existed/cancel`, {
      method: 'POST',
    });
    expect(response.status).toBe(404);
  });
});
