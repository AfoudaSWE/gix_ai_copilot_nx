import { afterEach, describe, expect, it } from 'vitest';
import { createEchoExecutor, createRuntime } from '@aicopilot/core';
import { createServer } from './app.js';
import type { CopilotEvent } from '@aicopilot/protocol';

function parseSseFrames(payload: string): CopilotEvent[] {
  return payload
    .split('\n\n')
    .filter((frame) => frame.trim().length > 0 && !frame.startsWith(':'))
    .map((frame) => {
      const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
      if (!dataLine) {
        throw new Error(`SSE frame missing a data line: ${frame}`);
      }
      return JSON.parse(dataLine.slice('data: '.length)) as CopilotEvent;
    });
}

describe('createServer', () => {
  let app: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('GET /health reports ok', async () => {
    app = createServer({ runtime: createRuntime({ executor: createEchoExecutor() }) });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('POST /runs streams a correctly ordered SSE event sequence for a valid request', async () => {
    app = createServer({ runtime: createRuntime({ executor: createEchoExecutor() }) });

    const response = await app.inject({
      method: 'POST',
      url: '/runs',
      payload: { message: { role: 'user', content: [{ type: 'text', text: 'Hello protocol' }] } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/event-stream');

    const events = parseSseFrames(response.payload);
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
  });

  it('POST /runs rejects a malformed body with a structured 400 error', async () => {
    app = createServer({ runtime: createRuntime({ executor: createEchoExecutor() }) });

    const response = await app.inject({
      method: 'POST',
      url: '/runs',
      payload: { message: { role: 'user' } },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /runs/:runId/cancel returns 404 for an id with no in-flight run', async () => {
    app = createServer({ runtime: createRuntime({ executor: createEchoExecutor() }) });

    const response = await app.inject({ method: 'POST', url: '/runs/not-a-real-run/cancel' });

    expect(response.statusCode).toBe(404);
    const body = response.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
