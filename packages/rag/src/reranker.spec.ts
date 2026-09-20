import { describe, expect, it } from 'vitest';
import { createSimilarityReranker } from './reranker.js';
import type { RetrievalItem } from './retriever.js';

function item(id: string, score: number): RetrievalItem {
  return {
    chunk: {
      id,
      documentId: 'doc-1',
      sourceId: 'source-1',
      content: id,
      metadata: { documentId: 'doc-1', sourceId: 'source-1', position: 0, contentHash: 'x' },
    },
    score,
    provenance: { sourceId: 'source-1', documentId: 'doc-1' },
  };
}

describe('createSimilarityReranker', () => {
  it('sorts items by score, highest first (Section 68 baseline)', async () => {
    const reranker = createSimilarityReranker();
    const items = [item('low', 0.2), item('high', 0.9), item('mid', 0.5)];
    const result = await reranker.rerank('query', items);
    expect(result.map((i) => i.chunk.id)).toEqual(['high', 'mid', 'low']);
  });

  it('does not mutate the input array', async () => {
    const reranker = createSimilarityReranker();
    const items = [item('a', 0.1), item('b', 0.9)];
    await reranker.rerank('query', items);
    expect(items.map((i) => i.chunk.id)).toEqual(['a', 'b']);
  });
});
