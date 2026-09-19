import { createRuntime } from '@gixcopilot/core';
import { createModelExecutor, createModelRuntime } from '@gixcopilot/provider';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { createServer } from '@gixcopilot/server';

const answer =
  '## A conversation, delivered in pieces\n\nServer-Sent Events keep a connection open so a server can send updates as they arrive. Your interface can show the first words while the rest are still being generated.\n\n- **Send** starts a new turn.\n- **Stop** cancels the running response.\n- **Regenerate** replaces the latest answer.\n\n```tsx\n<CopilotProvider runtimeUrl="/api/copilot">\n  <CopilotPopup />\n</CopilotProvider>\n```\n\n| Layer | Responsibility |\n| --- | --- |\n| React | Chat state and actions |\n| UI | The conversation interface |\n\nYou can also build a completely custom interface with the headless hooks.';

/** Credential-free example backend; the UI consumes the unchanged HTTP/SSE contract. */
export function createDemoServer(): ReturnType<typeof createServer> {
  const chunks = answer.match(/.{1,22}/gs) ?? [];
  const modelRuntime = createModelRuntime({
    providers: [
      createMockProvider({ id: 'mock', scenario: { chunks, delayMsPerChunk: 65 } }),
      createMockProvider({ id: 'slow', scenario: { chunks, delayMsPerChunk: 180 } }),
      createMockProvider({
        id: 'failure',
        scenario: (attempt) =>
          attempt % 2 === 1
            ? {
                failBeforeFirstChunk: {
                  code: 'NETWORK_ERROR',
                  message: 'Demo connection interrupted.',
                  retryable: true,
                },
              }
            : { chunks, delayMsPerChunk: 35 },
      }),
    ],
    defaults: { retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 } },
  });
  return createServer({
    modelRuntime,
    runtime: createRuntime({
      executor: createModelExecutor({
        runtime: modelRuntime,
        model: { provider: 'mock', model: 'demo' },
      }),
    }),
  });
}
