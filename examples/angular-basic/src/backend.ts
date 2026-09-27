import { createRuntime } from '@gixcopilot/core';
import { createModelExecutor, createModelRuntime } from '@gixcopilot/provider';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { createServer } from '@gixcopilot/server';

const answer =
  'Angular talks to the same Copilot server as React. The browser never holds a provider key: provideCopilot points at your server endpoint, and the server owns the model provider.';

/**
 * Credential-free demo server: a deterministic mock provider behind the unchanged HTTP/SSE
 * contract. The mock is labelled as such; swap in `@gixcopilot/provider-openai` (server-side)
 * for a real model.
 */
export function createDemoServer(options: { readonly delayMsPerChunk?: number } = {}): ReturnType<typeof createServer> {
  const chunks = answer.match(/.{1,24}/gs) ?? [];
  const modelRuntime = createModelRuntime({
    providers: [createMockProvider({ id: 'mock', scenario: { chunks, delayMsPerChunk: options.delayMsPerChunk ?? 40 } })],
    defaults: { retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 } },
  });
  return createServer({
    modelRuntime,
    runtime: createRuntime({
      executor: createModelExecutor({ runtime: modelRuntime, model: { provider: 'mock', model: 'demo' } }),
    }),
  });
}

export const DEMO_ANSWER = answer;
