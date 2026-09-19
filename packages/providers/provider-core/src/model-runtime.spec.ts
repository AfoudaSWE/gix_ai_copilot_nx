import { describe, expect, it } from 'vitest';
import { CopilotError } from '@gixcopilot/protocol';
import { createModelRuntime } from './model-runtime.js';
import type { ModelProvider } from './model-provider.js';
import type { ModelStreamEvent } from './model-stream-event.js';
import type { ModelRuntimeTelemetryEvent } from './telemetry.js';

function scriptedProvider(id: string, events: readonly ModelStreamEvent[]): ModelProvider {
  return {
    id,
    async *stream(_request, options) {
      await Promise.resolve();
      for (const event of events) {
        if (options?.signal?.aborted === true) {
          return;
        }
        yield event;
      }
    },
  };
}

function flakyThenSucceedProvider(
  id: string,
  failuresBeforeSuccess: number,
  retryable: boolean,
): ModelProvider {
  let attempts = 0;
  return {
    id,
    async *stream() {
      await Promise.resolve();
      attempts += 1;
      if (attempts <= failuresBeforeSuccess) {
        yield {
          type: 'model.failed',
          error: new CopilotError('PROVIDER_ERROR', 'flaky', { retryable }).toPublicJSON(),
        };
        return;
      }
      yield { type: 'content.delta', delta: 'ok' };
      yield { type: 'model.completed', finishReason: 'stop' };
    },
  };
}

function failAfterContentProvider(id: string): ModelProvider {
  return {
    id,
    async *stream() {
      await Promise.resolve();
      yield { type: 'content.delta', delta: 'partial' };
      yield {
        type: 'model.failed',
        error: new CopilotError('PROVIDER_ERROR', 'boom mid-stream', {
          retryable: true,
        }).toPublicJSON(),
      };
    },
  };
}

function hangingProvider(id: string): ModelProvider {
  return {
    id,
    async *stream(_request, options) {
      await new Promise<void>((resolve) => {
        options?.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    },
  };
}

async function collect(iterable: AsyncIterable<ModelStreamEvent>): Promise<ModelStreamEvent[]> {
  const collected: ModelStreamEvent[] = [];
  for await (const event of iterable) {
    collected.push(event);
  }
  return collected;
}

describe('createModelRuntime', () => {
  it('streams content deltas in order and completes with the provider-reported finish reason', async () => {
    const provider = scriptedProvider('mock', [
      { type: 'model.started' },
      { type: 'content.delta', delta: 'Hello' },
      { type: 'content.delta', delta: ' world' },
      {
        type: 'model.completed',
        finishReason: 'stop',
        usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
      },
    ]);
    const runtime = createModelRuntime({ providers: [provider] });

    const events = await collect(
      runtime.stream({ model: { provider: 'mock', model: 'test' }, messages: [] }),
    );

    expect(events.map((e) => e.type)).toEqual([
      'content.delta',
      'content.delta',
      'model.completed',
    ]);
    const completed = events.at(-1);
    expect(completed?.type === 'model.completed' && completed.finishReason).toBe('stop');
    expect(completed?.type === 'model.completed' && completed.usage).toEqual({
      inputTokens: 5,
      outputTokens: 2,
      totalTokens: 7,
    });
  });

  it('resolves provider/model from defaultProvider/defaultModel when the request omits them', async () => {
    const provider = scriptedProvider('mock', [{ type: 'model.completed', finishReason: 'stop' }]);
    const runtime = createModelRuntime({
      providers: [provider],
      defaultProvider: 'mock',
      defaultModel: 'default-model',
    });

    const events = await collect(runtime.stream({ messages: [] }));
    expect(events.map((e) => e.type)).toEqual(['model.completed']);
  });

  it('fails validation when no model is specified and no defaults are configured', async () => {
    const runtime = createModelRuntime({ providers: [] });
    const events = await collect(runtime.stream({ messages: [] }));
    expect(events).toHaveLength(1);
    expect(events[0]?.type === 'model.failed' && events[0].error.code).toBe('VALIDATION_ERROR');
  });

  it('fails with MODEL_NOT_FOUND for an unregistered provider, with no attempt telemetry', async () => {
    const telemetry: ModelRuntimeTelemetryEvent[] = [];
    const runtime = createModelRuntime({ providers: [], onTelemetry: (e) => telemetry.push(e) });

    const events = await collect(
      runtime.stream({ model: { provider: 'nope', model: 'x' }, messages: [] }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type === 'model.failed' && events[0].error.code).toBe('MODEL_NOT_FOUND');
    expect(telemetry).toEqual([]);
  });

  it('retries a retryable failure that happens before the first chunk, then succeeds', async () => {
    const provider = flakyThenSucceedProvider('mock', 1, true);
    const telemetry: ModelRuntimeTelemetryEvent[] = [];
    const runtime = createModelRuntime({
      providers: [provider],
      defaults: { retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 } },
      onTelemetry: (e) => telemetry.push(e),
    });

    const events = await collect(
      runtime.stream({ model: { provider: 'mock', model: 'x' }, messages: [] }),
    );
    expect(events.map((e) => e.type)).toEqual(['content.delta', 'model.completed']);

    const completedTelemetry = telemetry.find((e) => e.type === 'completed');
    expect(completedTelemetry?.type === 'completed' && completedTelemetry.attempts).toBe(2);
    expect(telemetry.filter((e) => e.type === 'attempt_failed')).toHaveLength(1);
  });

  it('does not retry a non-retryable failure, even with attempts remaining', async () => {
    const provider = flakyThenSucceedProvider('mock', 5, false);
    const runtime = createModelRuntime({
      providers: [provider],
      defaults: { retry: { maxAttempts: 5, baseDelayMs: 0, maxDelayMs: 0 } },
    });

    const events = await collect(
      runtime.stream({ model: { provider: 'mock', model: 'x' }, messages: [] }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type === 'model.failed' && events[0].error.code).toBe('PROVIDER_ERROR');
  });

  it('stops retrying once maxAttempts is exhausted', async () => {
    const provider = flakyThenSucceedProvider('mock', 10, true);
    const telemetry: ModelRuntimeTelemetryEvent[] = [];
    const runtime = createModelRuntime({
      providers: [provider],
      defaults: { retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 } },
      onTelemetry: (e) => telemetry.push(e),
    });

    const events = await collect(
      runtime.stream({ model: { provider: 'mock', model: 'x' }, messages: [] }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type === 'model.failed').toBe(true);
    expect(telemetry.filter((e) => e.type === 'attempt_started')).toHaveLength(2);
  });

  it('never retries once content has already been streamed, even for a retryable error', async () => {
    const provider = failAfterContentProvider('mock');
    const telemetry: ModelRuntimeTelemetryEvent[] = [];
    const runtime = createModelRuntime({
      providers: [provider],
      defaults: { retry: { maxAttempts: 5, baseDelayMs: 0, maxDelayMs: 0 } },
      onTelemetry: (e) => telemetry.push(e),
    });

    const events = await collect(
      runtime.stream({ model: { provider: 'mock', model: 'x' }, messages: [] }),
    );
    expect(events.map((e) => e.type)).toEqual(['content.delta', 'model.failed']);
    expect(telemetry.filter((e) => e.type === 'attempt_started')).toHaveLength(1);
  });

  it('produces a CANCELLED failure - not a retry - when the caller aborts', async () => {
    const provider = hangingProvider('mock');
    const telemetry: ModelRuntimeTelemetryEvent[] = [];
    const runtime = createModelRuntime({
      providers: [provider],
      defaults: { retry: { maxAttempts: 5, baseDelayMs: 0, maxDelayMs: 0 } },
      onTelemetry: (e) => telemetry.push(e),
    });

    const controller = new AbortController();
    const eventsPromise = collect(
      runtime.stream({
        model: { provider: 'mock', model: 'x' },
        messages: [],
        signal: controller.signal,
      }),
    );
    controller.abort();
    const events = await eventsPromise;

    expect(events).toHaveLength(1);
    expect(events[0]?.type === 'model.failed' && events[0].error.code).toBe('CANCELLED');
    expect(telemetry.filter((e) => e.type === 'attempt_started')).toHaveLength(1);
  });

  it('produces a TIMEOUT failure when the provider does not respond within timeoutMs, and retries it', async () => {
    const provider = hangingProvider('mock');
    const telemetry: ModelRuntimeTelemetryEvent[] = [];
    const runtime = createModelRuntime({
      providers: [provider],
      defaults: { timeoutMs: 20, retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 } },
      onTelemetry: (e) => telemetry.push(e),
    });

    const events = await collect(
      runtime.stream({ model: { provider: 'mock', model: 'x' }, messages: [] }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type === 'model.failed' && events[0].error.code).toBe('TIMEOUT');
    // timeout is retryable, and nothing was ever streamed, so it should have retried up to maxAttempts.
    expect(telemetry.filter((e) => e.type === 'attempt_started')).toHaveLength(2);
  });

  it('reports latency, including timeToFirstChunkMs once content has streamed', async () => {
    const provider = scriptedProvider('mock', [
      { type: 'content.delta', delta: 'hi' },
      { type: 'model.completed', finishReason: 'stop' },
    ]);
    const telemetry: ModelRuntimeTelemetryEvent[] = [];
    const runtime = createModelRuntime({
      providers: [provider],
      onTelemetry: (e) => telemetry.push(e),
    });

    await collect(runtime.stream({ model: { provider: 'mock', model: 'x' }, messages: [] }));

    const completed = telemetry.find((e) => e.type === 'completed');
    expect(completed?.type === 'completed' && completed.latency.totalMs).toBeGreaterThanOrEqual(0);
    expect(
      completed?.type === 'completed' && completed.latency.timeToFirstChunkMs,
    ).toBeGreaterThanOrEqual(0);
  });

  it('never fabricates usage when the provider does not report any', async () => {
    const provider = scriptedProvider('mock', [{ type: 'model.completed', finishReason: 'stop' }]);
    const runtime = createModelRuntime({ providers: [provider] });

    const events = await collect(
      runtime.stream({ model: { provider: 'mock', model: 'x' }, messages: [] }),
    );
    const completed = events.at(-1);
    expect(completed?.type === 'model.completed' && completed.usage).toBeUndefined();
  });

  it('passes tools through to the provider request and forwards a tool_call.requested event', async () => {
    let seenTools: unknown;
    const provider: ModelProvider = {
      id: 'mock',
      async *stream(request) {
        await Promise.resolve();
        seenTools = request.tools;
        yield {
          type: 'tool_call.requested',
          toolCall: { id: 'call-1', name: 'math.add', arguments: { a: 1, b: 2 } },
        };
        yield { type: 'model.completed', finishReason: 'tool_calls' };
      },
    };
    const runtime = createModelRuntime({ providers: [provider] });
    const tools = [{ name: 'math.add', description: 'Add', parameters: { type: 'object' } }];

    const events = await collect(
      runtime.stream({ model: { provider: 'mock', model: 'x' }, messages: [], tools }),
    );

    expect(seenTools).toEqual(tools);
    expect(events.map((event) => event.type)).toEqual(['tool_call.requested', 'model.completed']);
    const toolCallEvent = events.find((event) => event.type === 'tool_call.requested');
    expect(toolCallEvent?.type === 'tool_call.requested' && toolCallEvent.toolCall.name).toBe(
      'math.add',
    );
  });

  it('does not retry after a tool call has already been emitted, even if the stream then fails', async () => {
    let attempts = 0;
    const provider: ModelProvider = {
      id: 'mock',
      async *stream() {
        await Promise.resolve();
        attempts += 1;
        yield {
          type: 'tool_call.requested',
          toolCall: { id: 'call-1', name: 'math.add', arguments: {} },
        };
        yield {
          type: 'model.failed',
          error: CopilotError.provider('boom', undefined, true).toPublicJSON(),
        };
      },
    };
    const runtime = createModelRuntime({ providers: [provider] });
    const events = await collect(
      runtime.stream({ model: { provider: 'mock', model: 'x' }, messages: [] }),
    );
    expect(attempts).toBe(1);
    expect(events.at(-1)?.type).toBe('model.failed');
  });
});
