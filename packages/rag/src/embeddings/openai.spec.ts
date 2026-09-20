import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopilotError } from '@gixcopilot/protocol';
import { createOpenAIEmbeddingProvider } from './openai.js';

function embeddingResponse(vectors: readonly number[][]): Response {
  return new Response(
    JSON.stringify({
      object: 'list',
      data: vectors.map((embedding, index) => ({ object: 'embedding', embedding, index })),
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: 1, total_tokens: 1 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function errorResponse(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { message: code, type: code, code } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createOpenAIEmbeddingProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('embeds a single query using the injected fetch', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(embeddingResponse([[0.1, 0.2, 0.3]])));
    const provider = createOpenAIEmbeddingProvider({ apiKey: 'test-key', dimensions: 3, fetch: fetchMock });
    const vector = await provider.embedQuery('hello');
    expect(vector).toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('batches document embedding calls according to batchSize (Section 37)', async () => {
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as { input: readonly string[] };
      return Promise.resolve(embeddingResponse(body.input.map((_text, i) => [i])));
    });
    const provider = createOpenAIEmbeddingProvider({ apiKey: 'test-key', dimensions: 1, fetch: fetchMock, batchSize: 2 });
    const results = await provider.embedDocuments(['a', 'b', 'c', 'd', 'e']);
    expect(fetchMock).toHaveBeenCalledTimes(3); // [a,b] [c,d] [e]
    expect(results).toHaveLength(5);
  });

  it('preserves input order even if the API response is out of order', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            object: 'list',
            data: [
              { object: 'embedding', embedding: [2], index: 1 },
              { object: 'embedding', embedding: [1], index: 0 },
            ],
            model: 'text-embedding-3-small',
            usage: { prompt_tokens: 1, total_tokens: 1 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const provider = createOpenAIEmbeddingProvider({ apiKey: 'test-key', dimensions: 1, fetch: fetchMock });
    const results = await provider.embedDocuments(['first', 'second']);
    expect(results).toEqual([[1], [2]]);
  });

  it('reports dimensions from a known model, or the explicit override', () => {
    const defaultProvider = createOpenAIEmbeddingProvider({ apiKey: 'k', model: 'text-embedding-3-large' });
    expect(defaultProvider.dimensions).toBe(3072);
    const overridden = createOpenAIEmbeddingProvider({ apiKey: 'k', model: 'text-embedding-3-large', dimensions: 256 });
    expect(overridden.dimensions).toBe(256);
  });

  it('retries a rate-limited request and eventually succeeds', async () => {
    let calls = 0;
    const fetchMock = vi.fn(() => {
      calls++;
      return Promise.resolve(calls < 3 ? errorResponse(429, 'rate_limit_exceeded') : embeddingResponse([[1]]));
    });
    const provider = createOpenAIEmbeddingProvider({ apiKey: 'test-key', dimensions: 1, fetch: fetchMock, maxRetries: 3 });

    const promise = provider.embedQuery('hello');
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual([1]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('surfaces a non-retryable authentication failure as a normalized CopilotError', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(errorResponse(401, 'invalid_api_key')));
    const provider = createOpenAIEmbeddingProvider({ apiKey: 'bad-key', fetch: fetchMock, maxRetries: 3 });

    // Non-retryable: withRetry throws on the first attempt without ever sleeping, so no fake-timer advance is needed here.
    await expect(provider.embedQuery('hello')).rejects.toThrow(CopilotError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // non-retryable, no wasted attempts
  });

  it('embedDocuments on an empty array makes no request', async () => {
    const fetchMock = vi.fn();
    const provider = createOpenAIEmbeddingProvider({ apiKey: 'test-key', dimensions: 1, fetch: fetchMock });
    expect(await provider.embedDocuments([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
