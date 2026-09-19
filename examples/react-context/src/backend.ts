import { createRuntime } from '@gixcopilot/core';
import { createModelExecutor, createModelRuntime } from '@gixcopilot/provider';
import type { ModelProvider } from '@gixcopilot/provider';
import { createServer } from '@gixcopilot/server';

function extractField(text: string, field: string): string | undefined {
  const match = new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`).exec(text);
  return match?.[1];
}

function systemContextText(request: Parameters<ModelProvider['stream']>[0]): string {
  return request.messages
    .filter((message) => message.role === 'system')
    .flatMap((message) => message.content)
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n');
}

function chunk(text: string): string[] {
  return text.match(/.{1,14}/g) ?? [text];
}

/**
 * A deterministic, non-network `ModelProvider` (Section 15, like `@gixcopilot/provider-
 * mock`) whose *answer itself* is derived from the application context it receives in the
 * request's leading `system` message - proving Section 88's target experience end to end
 * through the real model/runtime pipeline, not a hardcoded UI response.
 */
function createContextAwareProvider(): ModelProvider {
  return {
    id: 'context-aware',
    async *stream(request) {
      await Promise.resolve(); // Deterministic/no real I/O, but stays a genuine async generator.
      yield { type: 'model.started' };
      const contextText = systemContextText(request);
      const id = extractField(contextText, 'id');
      const status = extractField(contextText, 'status');
      const applicantName = extractField(contextText, 'applicantName');

      const answer = id
        ? `You are currently viewing application ${id}${status ? `, which is ${status}` : ''}${applicantName ? ` (applicant: ${applicantName})` : ''}.`
        : "No application is selected right now - I don't have anything to tell you about.";

      for (const part of chunk(answer)) {
        yield { type: 'content.delta', delta: part };
      }
      yield { type: 'model.completed', finishReason: 'stop' };
    },
  };
}

/** Credential-free, deterministic demo backend for the application-context example. */
export function createDemoServer(): ReturnType<typeof createServer> {
  const provider = createContextAwareProvider();
  const modelRuntime = createModelRuntime({
    providers: [provider],
    defaults: { retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 } },
  });
  return createServer({
    modelRuntime,
    runtime: createRuntime({
      executor: createModelExecutor({ runtime: modelRuntime, model: { provider: provider.id, model: 'demo' } }),
    }),
  });
}
