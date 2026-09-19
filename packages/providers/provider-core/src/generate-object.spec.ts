import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { generateObject } from './generate-object.js';
import { createModelRuntime } from './model-runtime.js';
import type { ModelProvider } from './model-provider.js';

function providerReturning(json: string): ModelProvider {
  return {
    id: 'mock',
    async *stream() {
      await Promise.resolve();
      yield { type: 'content.delta', delta: json };
      yield { type: 'model.completed', finishReason: 'stop' };
    },
  };
}

describe('generateObject', () => {
  it('parses and validates the aggregated model output against the schema', async () => {
    const runtime = createModelRuntime({
      providers: [providerReturning('{"applicationId":"APP-1024","recommendation":"approve"}')],
    });
    const schema = z.object({ applicationId: z.string(), recommendation: z.string() });

    const result = await generateObject({
      runtime,
      model: { provider: 'mock', model: 'x' },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'evaluate APP-1024' }] }],
      schema,
    });

    expect(result.object).toEqual({ applicationId: 'APP-1024', recommendation: 'approve' });
  });

  it('rejects output that is not valid JSON', async () => {
    const runtime = createModelRuntime({ providers: [providerReturning('not json at all')] });
    await expect(
      generateObject({
        runtime,
        model: { provider: 'mock', model: 'x' },
        messages: [],
        schema: z.object({}),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects valid JSON that does not match the schema', async () => {
    const runtime = createModelRuntime({
      providers: [providerReturning('{"wrongField":true}')],
    });
    await expect(
      generateObject({
        runtime,
        model: { provider: 'mock', model: 'x' },
        messages: [],
        schema: z.object({ applicationId: z.string() }),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('propagates a normalized model.failed error', async () => {
    const failingProvider: ModelProvider = {
      id: 'mock',
      async *stream() {
        await Promise.resolve();
        yield {
          type: 'model.failed',
          error: { code: 'RATE_LIMITED', message: 'slow down', retryable: true },
        };
      },
    };
    const runtime = createModelRuntime({
      providers: [failingProvider],
      defaults: { retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 } },
    });
    await expect(
      generateObject({
        runtime,
        model: { provider: 'mock', model: 'x' },
        messages: [],
        schema: z.object({}),
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
