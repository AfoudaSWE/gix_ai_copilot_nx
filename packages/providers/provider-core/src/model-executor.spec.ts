import { describe, expect, it } from 'vitest';
import { createRunId, createThreadId, CopilotError } from '@gixcopilot/protocol';
import { createModelExecutor } from './model-executor.js';
import { createModelRuntime } from './model-runtime.js';
import type { ModelProvider } from './model-provider.js';
import type { ModelStreamEvent } from './model-stream-event.js';

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

function executorContext(signal: AbortSignal = new AbortController().signal) {
  return { runId: createRunId(), signal };
}

describe('createModelExecutor', () => {
  it('yields content deltas as plain strings', async () => {
    const runtime = createModelRuntime({
      providers: [
        scriptedProvider('mock', [
          { type: 'content.delta', delta: 'Hello' },
          { type: 'content.delta', delta: ' world' },
          { type: 'model.completed', finishReason: 'stop' },
        ]),
      ],
    });
    const executor = createModelExecutor({ runtime, model: { provider: 'mock', model: 'x' } });

    const generator = executor.execute(
      { threadId: createThreadId(), messages: [] },
      executorContext(),
    );
    const chunks: string[] = [];
    let step = await generator.next();
    while (!step.done) {
      chunks.push(step.value);
      step = await generator.next();
    }

    expect(chunks).toEqual(['Hello', ' world']);
    expect(step.value).toEqual({ usage: undefined, finishReason: 'stop' });
  });

  it('surfaces usage from the runtime on the ExecutorCompletion', async () => {
    const runtime = createModelRuntime({
      providers: [
        scriptedProvider('mock', [
          {
            type: 'model.completed',
            finishReason: 'length',
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          },
        ]),
      ],
    });
    const executor = createModelExecutor({ runtime, model: { provider: 'mock', model: 'x' } });

    const generator = executor.execute(
      { threadId: createThreadId(), messages: [] },
      executorContext(),
    );
    let step = await generator.next();
    while (!step.done) {
      step = await generator.next();
    }

    expect(step.value).toEqual({
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      finishReason: 'length',
    });
  });

  it('throws a CopilotError when the model runtime reports model.failed', async () => {
    const runtime = createModelRuntime({
      providers: [
        scriptedProvider('mock', [
          {
            type: 'model.failed',
            error: CopilotError.rateLimited('slow down').toPublicJSON(),
          },
        ]),
      ],
      defaults: { retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 } },
    });
    const executor = createModelExecutor({ runtime, model: { provider: 'mock', model: 'x' } });

    const generator = executor.execute(
      { threadId: createThreadId(), messages: [] },
      executorContext(),
    );
    await expect(generator.next()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('propagates the ExecutorContext signal through to the model runtime, so cancelling the run cancels the model call', async () => {
    let observedSignal: AbortSignal | undefined;
    const provider: ModelProvider = {
      id: 'mock',
      async *stream(_request, options) {
        observedSignal = options?.signal;
        await new Promise<void>((resolve) => {
          options?.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      },
    };
    const runtime = createModelRuntime({ providers: [provider] });
    const executor = createModelExecutor({ runtime, model: { provider: 'mock', model: 'x' } });

    const controller = new AbortController();
    const generator = executor.execute(
      { threadId: createThreadId(), messages: [] },
      { runId: createRunId(), signal: controller.signal },
    );
    const nextPromise = generator.next();
    controller.abort();

    // The raw Executor throws on cancellation (as it does on any model.failed); it is
    // @gixcopilot/core's own `cancellable()` wrapper around the Executor call, not the
    // Executor itself, that turns this into a clean run.cancelled with no thrown error -
    // see runtime.ts. This test only needs to confirm the abort signal actually reached
    // the provider and was classified as CANCELLED, not retried as a generic failure.
    await expect(nextPromise).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(observedSignal?.aborted).toBe(true);
  });

  it('throws an internal error if a provider emits tool_call.requested when no tools were offered', async () => {
    const runtime = createModelRuntime({
      providers: [
        scriptedProvider('mock', [
          {
            type: 'tool_call.requested',
            toolCall: { id: 'call-1', name: 'math.add', arguments: { a: 1, b: 2 } },
          },
        ]),
      ],
    });
    const executor = createModelExecutor({ runtime, model: { provider: 'mock', model: 'x' } });

    const generator = executor.execute(
      { threadId: createThreadId(), messages: [] },
      executorContext(),
    );
    await expect(generator.next()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
