import OpenAI from 'openai';
import type { FinishReason, Usage } from '@gixcopilot/protocol';
import type {
  ModelExecutionOptions,
  ModelProvider,
  ModelRequest,
  ModelStreamEvent,
} from '@gixcopilot/provider';
import { toOpenAIMessages } from './message-mapping.js';
import { mapFinishReason, toNormalizedError } from './error-mapping.js';

export interface CreateOpenAIProviderOptions {
  readonly id?: string;
  /** Falls back to the OPENAI_API_KEY environment variable - never sent anywhere but to OpenAI itself (Section 14). */
  readonly apiKey?: string;
  readonly baseURL?: string;
  /** Injectable for testing, so no real network call is needed - see the openai SDK's own `fetch` option. */
  readonly fetch?: typeof fetch;
  /** Injectable for testing: a fully pre-constructed (or fake) client, bypassing apiKey/baseURL/fetch above. */
  readonly client?: OpenAI;
}

function createClient(options: CreateOpenAIProviderOptions): OpenAI {
  if (options.client) {
    return options.client;
  }
  const apiKey = options.apiKey ?? process.env['OPENAI_API_KEY'];
  return new OpenAI({
    apiKey,
    // Retries are @gixcopilot/provider's ModelRuntime's job (Section 24), not the SDK's -
    // letting both retry independently would compound backoff delays in a way our own
    // retry policy and telemetry can't see or control.
    maxRetries: 0,
    ...(options.baseURL !== undefined ? { baseURL: options.baseURL } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
  });
}

function toUsage(usage: OpenAI.CompletionUsage | null | undefined): Usage | undefined {
  if (!usage) {
    return undefined;
  }
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

/**
 * The first real (non-mock) ModelProvider (Section 13/43). Only this package may depend on
 * the `openai` SDK - see docs/adr/0006-model-provider-abstraction.md. Text streaming only;
 * no tool/function calls, no assistants API, no vector stores, no hosted retrieval (all
 * explicitly out of Phase 2's scope).
 */
export function createOpenAIProvider(options: CreateOpenAIProviderOptions = {}): ModelProvider {
  const client = createClient(options);

  return {
    id: options.id ?? 'openai',
    async *stream(
      request: ModelRequest,
      execOptions?: ModelExecutionOptions,
    ): AsyncGenerator<ModelStreamEvent, void, undefined> {
      yield { type: 'model.started' };

      let chunks: AsyncIterable<OpenAI.ChatCompletionChunk>;
      try {
        chunks = await client.chat.completions.create(
          {
            model: request.model,
            messages: toOpenAIMessages(request.messages),
            stream: true,
            stream_options: { include_usage: true },
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
            ...(request.maxOutputTokens !== undefined
              ? { max_completion_tokens: request.maxOutputTokens }
              : {}),
          },
          { signal: execOptions?.signal },
        );
      } catch (error) {
        yield { type: 'model.failed', error: toNormalizedError(error).toPublicJSON() };
        return;
      }

      let finishReason: FinishReason = 'unknown';
      let usage: Usage | undefined;

      try {
        for await (const chunk of chunks) {
          const choice = chunk.choices[0];
          const delta = choice?.delta.content;
          if (delta) {
            yield { type: 'content.delta', delta };
          }
          if (choice?.finish_reason) {
            finishReason = mapFinishReason(choice.finish_reason);
          }
          const chunkUsage = toUsage(chunk.usage);
          if (chunkUsage) {
            usage = chunkUsage;
            yield { type: 'usage.updated', usage };
          }
        }
      } catch (error) {
        yield { type: 'model.failed', error: toNormalizedError(error).toPublicJSON() };
        return;
      }

      yield { type: 'model.completed', finishReason, usage };
    },
  };
}
