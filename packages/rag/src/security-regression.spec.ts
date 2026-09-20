import { describe, expect, it } from 'vitest';
import { textLoader, textSource } from '@gixcopilot/knowledge';
import { createInMemoryVectorStore } from './in-memory-vectorstore.js';
import { createIndexer } from './indexer.js';
import { createRecursiveChunker } from './chunker.js';
import { createDeterministicEmbeddingProvider } from './embeddings/deterministic.js';
import { createRetriever } from './retriever.js';
import type { VectorRecord } from './vectorstore.js';

const embeddingProvider = createDeterministicEmbeddingProvider();
async function record(id: string, tenantId?: string): Promise<VectorRecord> {
  return { id, chunkId: id, documentId: 'doc', sourceId: 'source', tenantId, content: 'Annual leave',
    embedding: await embeddingProvider.embedQuery('Annual leave'), embeddingProvider: embeddingProvider.provider, embeddingModel: embeddingProvider.model };
}

describe('Phase 9 review regressions', () => {
  it('upsert and delete isolate colliding IDs across tenants; an empty chunk filter deletes nothing', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert([await record('same', 'a'), await record('same', 'b')]);
    await store.delete({ tenantId: 'a', sourceId: 'source', chunkIds: [] });
    expect(await store.list?.({ tenantId: 'a', limit: 10 })).toHaveLength(1);
    await store.delete({ tenantId: 'a', documentId: 'doc' });
    expect(await store.list?.({ tenantId: 'a', limit: 10 })).toHaveLength(0);
    expect(await store.list?.({ tenantId: 'b', limit: 10 })).toHaveLength(1);
  });

  it('preserves the old document when embedding replacement fails', async () => {
    const store = createInMemoryVectorStore();
    const source = textSource({ id: 'source', tenantId: 'a', content: 'Existing policy' });
    const common = { vectorStore: store, chunker: createRecursiveChunker() };
    await createIndexer({ ...common, embeddingProvider }).index({ source, loader: textLoader });
    const failing = createIndexer({ ...common, embeddingProvider: { ...embeddingProvider, embedDocuments: () => Promise.reject(new Error('offline')) } });
    const result = await failing.reindex({ source: textSource({ ...source, content: 'New policy' }), loader: textLoader });
    expect(result.errors).toHaveLength(1);
    const stored = await store.list?.({ tenantId: 'a', limit: 10 });
    expect(stored?.[0]?.content).toBe('Existing policy');
  });

  it('pre-filters ACLs before topK so restricted nearest neighbors cannot starve public results', async () => {
    const store = createInMemoryVectorStore();
    const base = await record('public');
    await store.upsert([...Array.from({ length: 50 }, (_, i) => ({ ...base, id: `secret-${i}`, chunkId: `secret-${i}`, acl: { roles: ['admin'] } })), base]);
    const result = await createRetriever({ vectorStore: store, embeddingProvider }).retrieve({ text: 'Annual leave', topK: 1 }, { securityContext: {} });
    expect(result.items[0]?.item.chunk.id).toBe('public');
    expect(result.diagnostics.retrievedCount).toBe(1);
  });

  it('post-validates a broken adapter and does not let a reranker replace authorized content', async () => {
    const store = createInMemoryVectorStore();
    const safe = await record('safe', 'a');
    const secret = { ...await record('secret', 'b'), content: 'DO NOT DISCLOSE' };
    const retriever = createRetriever({ embeddingProvider, vectorStore: { ...store, search: () => Promise.resolve([{ record: safe, score: 1 }, { record: secret, score: 1 }]) },
      reranker: { rerank: (_query, items) => Promise.resolve(items.map((item) => ({ ...item, chunk: { ...item.chunk, content: 'FORGED RERANKER DATA' } }))) } });
    const result = await retriever.retrieve({ text: 'leave' }, { securityContext: { tenant: { tenantId: 'a' } } });
    expect(JSON.stringify(result)).not.toContain('DO NOT DISCLOSE');
    expect(result.items[0]?.item.chunk.content).toBe('Annual leave');
    expect(result.diagnostics.exclusions[0]?.reason).toBe('TENANT_MISMATCH');
  });

  it('omits private source URLs and redacts titles as well as body excerpts', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert([{ ...await record('safe'), content: 'Email secret@example.com', metadata: { title: 'secret@example.com', uri: 'file:///private/secrets.txt' } }]);
    const result = await createRetriever({ vectorStore: store, embeddingProvider }).retrieve({ text: 'email' }, { securityContext: {}, dataPolicy: { redactText: (text) => text.replaceAll('secret@example.com', '[redacted]') } });
    expect(JSON.stringify(result)).not.toContain('secret@example.com');
    expect(result.citations[0]?.uri).toBeUndefined();
  });

  it('rejects invalid limits and stops retrieval before any adapter call when cancelled', async () => {
    const store = createInMemoryVectorStore();
    const retriever = createRetriever({ vectorStore: store, embeddingProvider });
    await expect(retriever.retrieve({ text: 'x', topK: -1 }, { securityContext: {} })).rejects.toThrow();
    await expect(retriever.retrieve({ text: 'x' }, { securityContext: {}, signal: AbortSignal.abort() })).rejects.toThrow();
  });
});
