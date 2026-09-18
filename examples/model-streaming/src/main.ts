import { createServer } from '@aicopilot/server';
import { createEchoExecutor, createRuntime } from '@aicopilot/core';
import { createModelRuntime } from '@aicopilot/provider';
import type { ModelRuntimeTelemetryEvent } from '@aicopilot/provider';
import { createMockProvider } from '@aicopilot/provider-mock';
import { createOpenAIProvider } from '@aicopilot/provider-openai';
import { createCopilotClient } from '@aicopilot/client';
import type { CopilotEvent } from '@aicopilot/protocol';

function printEvent(event: CopilotEvent): void {
  switch (event.type) {
    case 'run.started':
    case 'run.cancelled':
    case 'message.started':
      break;
    case 'message.delta':
      process.stdout.write(event.delta);
      break;
    case 'message.end':
      process.stdout.write('\n\n');
      break;
    case 'run.completed':
      console.log(`Finish reason: ${event.finishReason ?? 'unknown'}`);
      console.log(
        `Input tokens: ${event.usage.inputTokens} | ` +
          `Output tokens: ${event.usage.outputTokens} | Total tokens: ${event.usage.totalTokens}`,
      );
      break;
    case 'run.failed':
      console.error(`Run failed: ${event.error.code} - ${event.error.message}`);
      break;
    case 'error':
      console.error(`Protocol error: ${event.error.code} - ${event.error.message}`);
      break;
    default: {
      const exhaustive: never = event;
      throw new Error(`Unhandled event type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

async function main(): Promise<void> {
  const providerId = process.env['MODEL_PROVIDER'] ?? 'mock';
  const openaiApiKey = process.env['OPENAI_API_KEY'];

  if (providerId === 'openai' && !openaiApiKey) {
    console.error(
      'MODEL_PROVIDER=openai requires OPENAI_API_KEY to be set. Falling back to the mock provider.',
    );
  }
  const usingOpenAI = providerId === 'openai' && Boolean(openaiApiKey);
  const modelName = process.env['MODEL_NAME'] ?? (usingOpenAI ? 'gpt-4o-mini' : 'mock-model');
  const inputText = process.argv[2] ?? 'Explain event-driven architecture in two sentences.';

  const providers = [
    createMockProvider({
      scenario: {
        chunks: inputText.match(/\S+|\s+/g) ?? [],
        finishReason: 'stop',
        delayMsPerChunk: 15,
      },
    }),
    ...(openaiApiKey ? [createOpenAIProvider({ apiKey: openaiApiKey })] : []),
  ];

  const modelRuntime = createModelRuntime({
    providers,
    defaults: { timeoutMs: 30_000, retry: { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 2_000 } },
    onTelemetry: (event: ModelRuntimeTelemetryEvent) => {
      if (event.type === 'attempt_failed') {
        console.error(
          `[telemetry] attempt_failed: ${event.code} (attempt ${event.attempt}/${event.maxAttempts})`,
        );
      } else if (event.type === 'failed') {
        console.error(`[telemetry] failed: ${event.code} (after ${event.attempts} attempt(s))`);
      }
    },
  });

  const runtime = createRuntime({ executor: createEchoExecutor() });
  const app = createServer({ runtime, modelRuntime });
  await app.listen({ port: 0, host: '127.0.0.1' });

  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected the server to bind to a TCP address.');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  console.log(`Provider: ${usingOpenAI ? 'openai' : 'mock'}`);
  console.log(`Model: ${usingOpenAI ? modelName : 'mock-model'}\n`);
  console.log(`> ${inputText}\n`);

  const client = createCopilotClient({ baseUrl });
  const run = client.run({
    model: {
      provider: usingOpenAI ? 'openai' : 'mock',
      model: usingOpenAI ? modelName : 'mock-model',
    },
    messages: [{ role: 'user', content: [{ type: 'text', text: inputText }] }],
  });

  try {
    for await (const event of run.events) {
      printEvent(event);
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Fatal error running the model-streaming demo:', error);
  process.exitCode = 1;
});
