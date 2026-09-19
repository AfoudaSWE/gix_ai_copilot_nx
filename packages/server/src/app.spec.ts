import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createEchoExecutor, createRuntime } from '@gixcopilot/core';
import { createModelRuntime } from '@gixcopilot/provider';
import type { ModelProvider } from '@gixcopilot/provider';
import { CopilotError } from '@gixcopilot/protocol';
import { createToolRegistry, defineTool } from '@gixcopilot/tools';
import { createServer } from './app.js';
import type { CopilotEvent } from '@gixcopilot/protocol';

/**
 * A minimal in-file fake ModelProvider, deliberately not @gixcopilot/provider-mock: server
 * must only ever depend on the provider *contract* (`@gixcopilot/provider`), never a
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

  describe('tool execution (Phase 5, Section 81/101)', () => {
    function toolCallingProvider(): ModelProvider {
      let call = 0;
      return {
        id: 'mock',
        async *stream() {
          await Promise.resolve();
          call += 1;
          if (call === 1) {
            yield {
              type: 'tool_call.requested',
              toolCall: {
                id: 'call-1',
                name: 'applications.getStatus',
                arguments: { applicationId: 'APP-1024' },
              },
            };
            yield { type: 'model.completed', finishReason: 'tool_calls' };
            return;
          }
          yield { type: 'content.delta', delta: 'APP-1024 is currently pending.' };
          yield { type: 'model.completed', finishReason: 'stop' };
        },
      };
    }

    it('runs the full Model -> Tool -> Model loop for a registered backend tool and streams tool.* events', async () => {
      const toolRegistry = createToolRegistry();
      toolRegistry.register(
        defineTool({
          name: 'applications.getStatus',
          description: 'Get application status',
          input: z.object({ applicationId: z.string() }),
          output: z.object({ applicationId: z.string(), status: z.string() }),
          execute({ applicationId }) {
            return Promise.resolve({ applicationId, status: 'PENDING' });
          },
        }),
      );
      const modelRuntime = createModelRuntime({ providers: [toolCallingProvider()] });
      app = createServer({
        runtime: createRuntime({ executor: createEchoExecutor() }),
        modelRuntime,
        toolRegistry,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/runs',
        payload: {
          model: { provider: 'mock', model: 'mock-model' },
          messages: [{ role: 'user', content: [{ type: 'text', text: 'What is APP-1024 status?' }] }],
        },
      });

      expect(response.statusCode).toBe(200);
      const events = parseSseFrames(response.payload);
      expect(events.map((e) => e.type)).toEqual([
        'run.started',
        'message.started',
        'tool.requested',
        'tool.started',
        'tool.completed',
        'message.delta',
        'message.end',
        'run.completed',
      ]);

      const requested = events.find((e) => e.type === 'tool.requested');
      expect(requested?.type === 'tool.requested' && requested.source).toBe('native');
      expect(requested?.type === 'tool.requested' && requested.arguments).toEqual({
        applicationId: 'APP-1024',
      });
      const completedTool = events.find((e) => e.type === 'tool.completed');
      expect(completedTool?.type === 'tool.completed' && completedTool.result).toEqual({
        applicationId: 'APP-1024',
        status: 'PENDING',
      });
      const end = events.find((e) => e.type === 'message.end');
      expect(end?.type === 'message.end' && end.content).toEqual([
        { type: 'text', text: 'APP-1024 is currently pending.' },
      ]);
    });

    it('rejects a model call to an unregistered tool as TOOL_NOT_FOUND, feeds the error back to the model, and the model recovers (Section 77/84)', async () => {
      let call = 0;
      const provider: ModelProvider = {
        id: 'mock',
        async *stream(request) {
          await Promise.resolve();
          call += 1;
          if (call === 1) {
            yield {
              type: 'tool_call.requested',
              toolCall: { id: 'call-1', name: 'no.such.tool', arguments: {} },
            };
            yield { type: 'model.completed', finishReason: 'tool_calls' };
            return;
          }
          const toolMessage = request.messages.find((m) => m.role === 'tool');
          expect(toolMessage).toBeDefined();
          yield { type: 'content.delta', delta: 'That tool is not available.' };
          yield { type: 'model.completed', finishReason: 'stop' };
        },
      };
      app = createServer({
        runtime: createRuntime({ executor: createEchoExecutor() }),
        modelRuntime: createModelRuntime({ providers: [provider] }),
        toolRegistry: createToolRegistry(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/runs',
        payload: {
          model: { provider: 'mock', model: 'mock-model' },
          messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
        },
      });

      const events = parseSseFrames(response.payload);
      expect(events.map((e) => e.type)).toEqual([
        'run.started',
        'message.started',
        'tool.requested',
        'message.delta',
        'message.end',
        'run.completed',
      ]);
      // ToolRuntime never emits started/completed/failed for a genuinely unresolvable name
      // (see @gixcopilot/tools' tool-runtime.spec.ts) - only 'requested' (the caller's own
      // notification) appears; the failure surfaces to the model as a tool_result, not as a
      // thrown error or a run.failed.
      expect(events.some((e) => e.type === 'tool.failed')).toBe(false);
      const end = events.find((e) => e.type === 'message.end');
      expect(end?.type === 'message.end' && end.content).toEqual([
        { type: 'text', text: 'That tool is not available.' },
      ]);
    });

    it('a run with no toolRegistry and no request-declared tools behaves exactly as Phase 2 (no tool.* events)', async () => {
      const provider: ModelProvider = {
        id: 'mock',
        async *stream() {
          await Promise.resolve();
          yield { type: 'content.delta', delta: 'plain answer' };
          yield { type: 'model.completed', finishReason: 'stop' };
        },
      };
      app = createServer({
        runtime: createRuntime({ executor: createEchoExecutor() }),
        modelRuntime: createModelRuntime({ providers: [provider] }),
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
      expect(events.map((e) => e.type)).toEqual([
        'run.started',
        'message.started',
        'message.delta',
        'message.end',
        'run.completed',
      ]);
    });

    it('POST /runs/:runId/tool-results returns 404 for an unknown/already-resolved runId+toolCallId', async () => {
      app = createServer({ runtime: createRuntime({ executor: createEchoExecutor() }) });
      const response = await app.inject({
        method: 'POST',
        url: '/runs/not-a-real-run/tool-results',
        payload: { toolCallId: 'call-1', result: { status: 'success', toolCallId: 'call-1', data: {} } },
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
