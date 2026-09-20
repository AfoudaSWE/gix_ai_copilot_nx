import { describe, expect, it } from 'vitest';
import { createInMemoryVectorStore } from './in-memory-vectorstore.js';
import type { VectorRecord } from './vectorstore.js';

function record(overrides: Partial<VectorRecord> & Pick<VectorRecord, 'id'>): VectorRecord {
  return {
    chunkId: overrides.id,
    documentId: 'doc-1',
    sourceId: 'source-1',
    tenantId: 'tenant-a',
    content: 'content',
    embedding: [1, 0, 0],
    embeddingProvider: 'test',
    embeddingModel: 'test',
    ...overrides,
  };
}

describe('createInMemoryVectorStore', () => {
  it('upserts and retrieves records via search', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert([record({ id: 'r1', embedding: [1, 0, 0] })]);
    const results = await store.search({ embedding: [1, 0, 0], tenantId: 'tenant-a', topK: 5 });
    expect(results).toHaveLength(1);
    expect(results[0]?.record.id).toBe('r1');
    expect(results[0]?.score).toBeCloseTo(1, 5);
  });

  it('upsert overwrites an existing record with the same id (no duplicates)', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert([record({ id: 'r1', content: 'v1' })]);
    await store.upsert([record({ id: 'r1', content: 'v2' })]);
    const results = await store.search({ embedding: [1, 0, 0], tenantId: 'tenant-a', topK: 5 });
    expect(results).toHaveLength(1);
    expect(results[0]?.record.content).toBe('v2');
  });

  it('ranks results by cosine similarity, highest first', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert([
      record({ id: 'far', embedding: [0, 1, 0] }),
      record({ id: 'close', embedding: [0.9, 0.1, 0] }),
      record({ id: 'exact', embedding: [1, 0, 0] }),
    ]);
    const results = await store.search({ embedding: [1, 0, 0], tenantId: 'tenant-a', topK: 5 });
    expect(results.map((r) => r.record.id)).toEqual(['exact', 'close', 'far']);
  });

  it('respects topK', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert([
      record({ id: 'a', embedding: [1, 0, 0] }),
      record({ id: 'b', embedding: [1, 0, 0] }),
      record({ id: 'c', embedding: [1, 0, 0] }),
    ]);
    const results = await store.search({ embedding: [1, 0, 0], tenantId: 'tenant-a', topK: 2 });
    expect(results).toHaveLength(2);
  });

  it('respects a similarity threshold', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert([record({ id: 'orthogonal', embedding: [0, 1, 0] })]);
    const results = await store.search({ embedding: [1, 0, 0], tenantId: 'tenant-a', topK: 5, threshold: 0.5 });
    expect(results).toHaveLength(0);
  });

  it('enforces tenant scoping at the query level - mandatory (Section 154)', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert([
      record({ id: 'a-doc', tenantId: 'tenant-a', embedding: [1, 0, 0] }),
      record({ id: 'b-doc', tenantId: 'tenant-b', embedding: [1, 0, 0] }),
    ]);
    const resultsA = await store.search({ embedding: [1, 0, 0], tenantId: 'tenant-a', topK: 5 });
    const resultsB = await store.search({ embedding: [1, 0, 0], tenantId: 'tenant-b', topK: 5 });
    expect(resultsA.map((r) => r.record.id)).toEqual(['a-doc']);
    expect(resultsB.map((r) => r.record.id)).toEqual(['b-doc']);
  });

  it('treats a record with no tenantId as shared/global, visible to any tenant query', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert([record({ id: 'global-doc', tenantId: undefined, embedding: [1, 0, 0] })]);
    const resultsA = await store.search({ embedding: [1, 0, 0], tenantId: 'tenant-a', topK: 5 });
    const resultsB = await store.search({ embedding: [1, 0, 0], tenantId: 'tenant-b', topK: 5 });
    expect(resultsA.map((r) => r.record.id)).toEqual(['global-doc']);
    expect(resultsB.map((r) => r.record.id)).toEqual(['global-doc']);
  });

  it('filters by sourceId/documentId/tags/metadata', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert([
      record({ id: 'a', sourceId: 'src-a', embedding: [1, 0, 0], metadata: { tags: ['hr'], region: 'ae' } }),
      record({ id: 'b', sourceId: 'src-b', embedding: [1, 0, 0], metadata: { tags: ['finance'], region: 'us' } }),
    ]);
    const bySource = await store.search({ embedding: [1, 0, 0], tenantId: 'tenant-a', topK: 5, filters: { sourceId: 'src-a' } });
    expect(bySource.map((r) => r.record.id)).toEqual(['a']);

    const byTag = await store.search({ embedding: [1, 0, 0], tenantId: 'tenant-a', topK: 5, filters: { tags: ['finance'] } });
    expect(byTag.map((r) => r.record.id)).toEqual(['b']);

    const byMetadata = await store.search({
      embedding: [1, 0, 0],
      tenantId: 'tenant-a',
      topK: 5,
      filters: { metadata: { region: 'ae' } },
    });
    expect(byMetadata.map((r) => r.record.id)).toEqual(['a']);
  });

  it('deletes by sourceId, documentId, and chunkIds', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert([
      record({ id: 'a', sourceId: 'src-a', documentId: 'doc-a' }),
      record({ id: 'b', sourceId: 'src-a', documentId: 'doc-b' }),
      record({ id: 'c', sourceId: 'src-b', documentId: 'doc-c' }),
    ]);
    await store.delete({ tenantId: 'tenant-a', documentId: 'doc-a' });
    let results = await store.search({ embedding: [1, 0, 0], tenantId: 'tenant-a', topK: 10 });
    expect(results.map((r) => r.record.id).sort()).toEqual(['b', 'c']);

    await store.delete({ tenantId: 'tenant-a', sourceId: 'src-b' });
    results = await store.search({ embedding: [1, 0, 0], tenantId: 'tenant-a', topK: 10 });
    expect(results.map((r) => r.record.id)).toEqual(['b']);

    await store.delete({ tenantId: 'tenant-a', chunkIds: ['b'] });
    results = await store.search({ embedding: [1, 0, 0], tenantId: 'tenant-a', topK: 10 });
    expect(results).toHaveLength(0);
  });

  it('returns no results for an empty store rather than throwing', async () => {
    const store = createInMemoryVectorStore();
    const results = await store.search({ embedding: [1, 0, 0], tenantId: 'tenant-a', topK: 5 });
    expect(results).toEqual([]);
  });
});
