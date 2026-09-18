import { afterEach, describe, expect, it } from 'vitest';
import { createEchoExecutor, createRuntime } from '@aicopilot/core';
import { createModelRuntime } from '@aicopilot/provider';
import type { ModelProvider } from '@aicopilot/provider';
import { CopilotError } from '@aicopilot/protocol';
import { createServer } from './app.js';
import type { CopilotEvent } from '@aicopilot/protocol';

/**
 * A minimal in-file fake ModelProvider, deliberately not @aicopilot/provider-mock: server
 * must only ever depend on the provider *contract* (`@aicopilot/provider`), never a
 * concrete adapter, even in tests - see the module boundary rule in eslint.config.js.
 */
function fakeProvider(scenario: {
  readonly chunks?: readonly string[];
  readonly failure?: { readonly code: 'AUTHENTICATION_ERROR'; readonly message: string };
}): ModelProvider {
  return {
    id: 'mock',
    async *stream() {
      await Promise.resolve();
      if (scenario.failure) {
        yield {
          type: 'model.failed',
          error: new CopilotError(scenario.failure.code, scenario.failure.message).toPublicJSON(),
        };
        return;
      }
      for (const chunk of scenario.chunks ?? []) {
        yield { type: 'content.delta', delta: chunk };
      }
      yield { type: 'model.completed', finishReason: 'stop' as const };
    },
  };
}

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
      payload: {
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello protocol' }] }],
      },
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
      payload: { messages: [{ role: 'user' }] },
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

  describe('model execution (Phase 2)', () => {
    it('routes a request naming a model through the configured modelRuntime', async () => {
      const modelRuntime = createModelRuntime({
        providers: [fakeProvider({ chunks: ['Hi', ' there'] })],
      });
      app = createServer({
        runtime: createRuntime({ executor: createEchoExecutor() }),
        modelRuntime,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/runs',
        payload: {
          model: { provider: 'mock', model: 'mock-model' },
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        },
      });

      expect(response.statusCode).toBe(200);
      const events = parseSseFrames(response.payload);
      expect(events.map((e) => e.type)).toEqual([
        'run.started',
        'message.started',
        'message.delta',
        'message.delta',
        'message.end',
        'run.completed',
      ]);
      const completed = events.at(-1);
      expect(completed?.type === 'run.completed' && completed.finishReason).toBe('stop');
    });

    it('surfaces a model.failed provider error as run.failed with the normalized code', async () => {
      const modelRuntime = createModelRuntime({
        providers: [
          fakeProvider({ failure: { code: 'AUTHENTICATION_ERROR', message: 'bad key' } }),
        ],
      });
      app = createServer({
        runtime: createRuntime({ executor: createEchoExecutor() }),
        modelRuntime,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/runs',
        payload: {
          model: { provider: 'mock', model: 'mock-model' },
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        },
      });

      const events = parseSseFrames(response.payload);
      expect(events.map((e) => e.type)).toEqual(['run.started', 'message.started', 'run.failed']);
      const failed = events.at(-1);
      expect(failed?.type === 'run.failed' && failed.error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('rejects a model-naming request with 400 when no modelRuntime is configured', async () => {
      app = createServer({ runtime: createRuntime({ executor: createEchoExecutor() }) });

      const response = await app.inject({
        method: 'POST',
        url: '/runs',
        payload: {
          model: { provider: 'mock', model: 'mock-model' },
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ error: { code: string } }>();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
