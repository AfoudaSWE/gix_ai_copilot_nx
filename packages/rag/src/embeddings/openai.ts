import OpenAI, {
  APIConnectionError,
  APIUserAbortError,
  AuthenticationError,
  RateLimitError,
} from 'openai';
import { CopilotError } from '@gixcopilot/protocol';
import { withRetry } from '../retry.js';
import type { EmbeddingProvider } from './embedding-provider.js';

export interface CreateOpenAIEmbeddingProviderOptions {
  readonly id?: string;
  /** Falls back to the OPENAI_API_KEY environment variable - never sent anywhere but to OpenAI itself. */
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly model?: string;
  /** Overrides the model's native dimension count (supported by text-embedding-3-* models). */
  readonly dimensions?: number;
  /** Texts per embeddings.create call - avoids one API request per chunk (Section 37). Default: 100. */
  readonly batchSize?: number;
  readonly maxRetries?: number;
  /** Injectable for testing, so no real network call is needed. */
  readonly fetch?: typeof fetch;
  /** Injectable for testing: a fully pre-constructed (or fake) client, bypassing apiKey/baseURL/fetch above. */
  readonly client?: OpenAI;
}

/** Known dimension counts for OpenAI's published embedding models, used only when the caller doesn't pin `dimensions` explicitly. */
const KNOWN_MODEL_DIMENSIONS: Readonly<Record<string, number>> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};
const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_BATCH_SIZE = 100;

function createClient(options: CreateOpenAIEmbeddingProviderOptions): OpenAI {
  if (options.client) return options.client;
  const apiKey = options.apiKey ?? process.env['OPENAI_API_KEY'];
  return new OpenAI({
    apiKey,
    maxRetries: 0, // retries are this module's own withRetry's job - see the ai-runtime skill precedent in provider-openai
    ...(options.baseURL !== undefined ? { baseURL: options.baseURL } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
  });
}

function toNormalizedError(error: unknown): CopilotError {
  if (CopilotError.isCopilotError(error)) return error;
  if (error instanceof APIUserAbortError) return CopilotError.cancelled();
  if (error instanceof AuthenticationError) {
    return CopilotError.embeddingFailed('OpenAI embedding authentication failed.', undefined, false);
  }
  if (error instanceof RateLimitError) {
    return CopilotError.embeddingFailed('OpenAI embedding rate limit exceeded.', undefined, true);
  }
  if (error instanceof APIConnectionError) {
    return CopilotError.embeddingFailed(`OpenAI embedding connection error: ${error.message}`, undefined, true);
  }
  if (error instanceof OpenAI.APIError) {
    const retryable = typeof error.status === 'number' && error.status >= 500;
    return CopilotError.embeddingFailed(error.message, { status: error.status ?? undefined }, retryable);
  }
  return CopilotError.embeddingFailed(`Unknown OpenAI embedding error: ${String(error)}`, undefined, false);
}

function isRetryableError(error: unknown): boolean {
  return error instanceof RateLimitError || error instanceof APIConnectionError || (error instanceof OpenAI.APIError && (error.status ?? 0) >= 500);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/**
 * Real OpenAI embeddings adapter (Section 35). The only package besides
 * `@gixcopilot/providers/openai` allowed to depend on the `openai` SDK, per the same "confine a
 * provider SDK to one adapter" rule (ADR 0006) - `@gixcopilot/rag` itself stays provider-neutral
 * through the `EmbeddingProvider` interface.
 */
export function createOpenAIEmbeddingProvider(
  options: CreateOpenAIEmbeddingProviderOptions = {},
): EmbeddingProvider {
  const client = createClient(options);
  const model = options.model ?? DEFAULT_MODEL;
  const dimensions = options.dimensions ?? KNOWN_MODEL_DIMENSIONS[model] ?? KNOWN_MODEL_DIMENSIONS[DEFAULT_MODEL] ?? 1536;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxAttempts = options.maxRetries ?? 3;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || !Number.isSafeInteger(dimensions) || dimensions < 1 || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw CopilotError.validation('Embedding dimensions, batch size and retry attempts must be positive integers.');
  }

  async function embedBatch(texts: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    signal?.throwIfAborted();
    if (texts.length === 0) return [];
    const response = await withRetry(
      () =>
        client.embeddings.create({
          input: [...texts],
          model,
          ...(options.dimensions !== undefined ? { dimensions: options.dimensions } : {}),
        }, { signal }),
      { maxAttempts, shouldRetry: isRetryableError, signal },
    ).catch((error: unknown) => {
      throw toNormalizedError(error);
    });
    signal?.throwIfAborted();
    const ordered = [...response.data].sort((a, b) => a.index - b.index);
    if (ordered.length !== texts.length || ordered.some((item, index) => item.index !== index || item.embedding.length !== dimensions || !item.embedding.every(Number.isFinite))) {
      throw CopilotError.embeddingFailed('OpenAI returned malformed or incompatible embeddings.', undefined, false);
    }
    return ordered.map((item) => item.embedding);
  }

  return {
    provider: options.id ?? 'openai',
    model,
    dimensions,
    async embedDocuments(texts: readonly string[], request): Promise<number[][]> {
      const batches = chunk(texts, batchSize);
      const results: number[][] = [];
      for (const batch of batches) {
        results.push(...(await embedBatch(batch, request?.signal)));
      }
      return results;
    },
    async embedQuery(text: string, request): Promise<number[]> {
      const [embedding] = await embedBatch([text], request?.signal);
      if (!embedding) {
        throw CopilotError.embeddingFailed('OpenAI returned no embedding for the query.', undefined, false);
      }
      return embedding;
    },
  };
}
