import { describe, expect, it } from 'vitest';
import { createMockProvider } from './mock-provider.js';
import type { ModelStreamEvent } from '@aicopilot/provider';

async function collect(
  provider: ReturnType<typeof createMockProvider>,
  signal?: AbortSignal,
): Promise<ModelStreamEvent[]> {
  const collected: ModelStreamEvent[] = [];
  for await (const event of provider.stream({ model: 'mock-model', messages: [] }, { signal })) {
    collected.push(event);
  }
  return collected;
}

describe('createMockProvider', () => {
  it('streams a normal response: started, deltas, completed', async () => {
    const provider = createMockProvider({
      scenario: { chunks: ['Hello', ' world'], finishReason: 'stop' },
    });
    const events = await collect(provider);
    expect(events.map((e) => e.type)).toEqual([
      'model.started',
      'content.delta',
      'content.delta',
      'model.completed',
    ]);
  });

  it('supports a controlled delay between chunks', async () => {
    const provider = createMockProvider({ scenario: { chunks: ['a', 'b'], delayMsPerChunk: 5 } });
    const start = Date.now();
    await collect(provider);
    expect(Date.now() - start).toBeGreaterThanOrEqual(5);
  });

  it('fails before the first chunk when configured to', async () => {
    const provider = createMockProvider({
      scenario: { failBeforeFirstChunk: { code: 'AUTHENTICATION_ERROR', message: 'bad key' } },
    });
    const events = await collect(provider);
    expect(events.map((e) => e.type)).toEqual(['model.started', 'model.failed']);
    const failed = events.at(-1);
    expect(failed?.type === 'model.failed' && failed.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('fails mid-stream after a configured number of chunks', async () => {
    const provider = createMockProvider({
      scenario: {
        chunks: ['a', 'b', 'c'],
        failDuringStream: {
          afterChunks: 2,
          code: 'PROVIDER_ERROR',
          message: 'boom',
          retryable: true,
        },
      },
    });
    const events = await collect(provider);
    expect(events.map((e) => e.type)).toEqual([
      'model.started',
      'content.delta',
      'content.delta',
      'model.failed',
    ]);
  });

  it('stops promptly once its signal is aborted, mid-stream', async () => {
    const provider = createMockProvider({
      scenario: { chunks: ['a', 'b', 'c'], delayMsPerChunk: 50 },
    });
    const controller = new AbortController();
    const events: ModelStreamEvent[] = [];
    const iterator = provider
      .stream({ model: 'x', messages: [] }, { signal: controller.signal })
      [Symbol.asyncIterator]();

    events.push((await iterator.next()).value as ModelStreamEvent); // model.started
    events.push((await iterator.next()).value as ModelStreamEvent); // first delta
    controller.abort();
    const afterAbort = await iterator.next();

    expect(afterAbort.done).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['model.started', 'content.delta']);
  });

  it('reports usage only when the scenario provides it', async () => {
    const withUsage = createMockProvider({
      scenario: { chunks: ['hi'], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
    });
    const withUsageEvents = await collect(withUsage);
    expect(withUsageEvents.map((e) => e.type)).toContain('usage.updated');
    const completedWithUsage = withUsageEvents.find((e) => e.type === 'model.completed');
    expect(completedWithUsage?.type === 'model.completed' && completedWithUsage.usage).toEqual({
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    });

    const withoutUsage = createMockProvider({ scenario: { chunks: ['hi'] } });
    const withoutUsageEvents = await collect(withoutUsage);
    expect(withoutUsageEvents.map((e) => e.type)).not.toContain('usage.updated');
    const completedWithoutUsage = withoutUsageEvents.find((e) => e.type === 'model.completed');
    expect(
      completedWithoutUsage?.type === 'model.completed' && completedWithoutUsage.usage,
    ).toBeUndefined();
  });

  it('defaults finishReason to "stop" when the scenario does not specify one', async () => {
    const provider = createMockProvider({ scenario: { chunks: ['hi'] } });
    const events = await collect(provider);
    const completed = events.at(-1);
    expect(completed?.type === 'model.completed' && completed.finishReason).toBe('stop');
  });

  it('supports a per-attempt scenario function, enabling retry-then-succeed test scenarios', async () => {
    const provider = createMockProvider({
      scenario: (attempt) =>
        attempt === 1
          ? {
              failBeforeFirstChunk: { code: 'RATE_LIMITED', message: 'slow down', retryable: true },
            }
          : { chunks: ['ok'], finishReason: 'stop' },
    });

    const firstAttempt = await collect(provider);
    expect(firstAttempt.map((e) => e.type)).toEqual(['model.started', 'model.failed']);

    const secondAttempt = await collect(provider);
    expect(secondAttempt.map((e) => e.type)).toEqual([
      'model.started',
      'content.delta',
      'model.completed',
    ]);
  });

  it('uses "mock" as the default id, and honors a custom id', () => {
    expect(createMockProvider().id).toBe('mock');
    expect(createMockProvider({ id: 'mock-2' }).id).toBe('mock-2');
  });
});
