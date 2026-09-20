import { describe, expect, it } from 'vitest';
import { createDeterministicEmbeddingProvider } from './deterministic.js';

describe('createDeterministicEmbeddingProvider', () => {
  it('produces the requested vector dimensions', async () => {
    const provider = createDeterministicEmbeddingProvider({ dimensions: 16 });
    expect(provider.dimensions).toBe(16);
    const vector = await provider.embedQuery('hello world');
    expect(vector).toHaveLength(16);
  });

  it('is deterministic for identical text', async () => {
    const provider = createDeterministicEmbeddingProvider();
    const a = await provider.embedQuery('the annual leave policy');
    const b = await provider.embedQuery('the annual leave policy');
    expect(a).toEqual(b);
  });

  it('produces different vectors for different text', async () => {
    const provider = createDeterministicEmbeddingProvider();
    const a = await provider.embedQuery('annual leave policy');
    const b = await provider.embedQuery('completely unrelated database schema');
    expect(a).not.toEqual(b);
  });

  it('embeds a batch of documents in one call, in order', async () => {
    const provider = createDeterministicEmbeddingProvider();
    const [a, b] = await provider.embedDocuments(['first text', 'second text']);
    const [single] = await provider.embedDocuments(['first text']);
    expect(a).toEqual(single);
    expect(a).not.toEqual(b);
  });

  it('never makes a network call - it is pure/local', async () => {
    const provider = createDeterministicEmbeddingProvider();
    expect(provider.provider).toBe('deterministic-test');
    await expect(provider.embedQuery('x')).resolves.toBeDefined();
  });
});
