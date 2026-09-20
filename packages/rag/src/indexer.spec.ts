import { textLoader, textSource } from '@gixcopilot/knowledge';
import { describe, expect, it } from 'vitest';
import { createRecursiveChunker } from './chunker.js';
import { createDeterministicEmbeddingProvider } from './embeddings/deterministic.js';
import { createIndexer } from './indexer.js';
import { createInMemoryVectorStore } from './in-memory-vectorstore.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

function setup() {
  const vectorStore = createInMemoryVectorStore();
  const indexer = createIndexer({
    chunker: createRecursiveChunker({ chunkSize: 50, chunkOverlap: 10 }),
    embeddingProvider: createDeterministicEmbeddingProvider(),
    vectorStore,
  });
  return { vectorStore, indexer };
}

describe('createIndexer', () => {
  it('indexes a source end to end and returns real counts', async () => {
    const { indexer, vectorStore } = setup();
    const source = textSource({ id: 'src-1', tenantId: 'tenant-a', content: 'Employees receive 25 days of annual leave per year.' });
    const result = await indexer.index({ source, loader: textLoader });

    expect(result.documentsLoaded).toBe(1);
    expect(result.documentsIndexed).toBe(1);
    expect(result.chunksCreated).toBeGreaterThan(0);
    expect(result.chunksEmbedded).toBe(result.chunksCreated);
    expect(result.chunksStored).toBe(result.chunksCreated);
    expect(result.errors).toEqual([]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    const stored = await vectorStore.search({ embedding: await createDeterministicEmbeddingProvider().embedQuery('leave'), tenantId: 'tenant-a', topK: 10 });
    expect(stored.length).toBe(result.chunksStored);
  });

  it('is idempotent - indexing the same unchanged document twice does not duplicate chunks (Section 131)', async () => {
    const { indexer, vectorStore } = setup();
    const source = textSource({ id: 'src-1', tenantId: 'tenant-a', content: 'Stable content that does not change.' });
    await indexer.index({ source, loader: textLoader });
    const before = await vectorStore.search({ embedding: new Array(32).fill(0), tenantId: 'tenant-a', topK: 100 });

    await indexer.index({ source, loader: textLoader });
    const after = await vectorStore.search({ embedding: new Array(32).fill(0), tenantId: 'tenant-a', topK: 100 });

    expect(after.length).toBe(before.length);
  });

  it('skips re-embedding when getStoredContentHash reports an unchanged document', async () => {
    const { vectorStore } = setup();
    let embedCalls = 0;
    const embeddingProvider = createDeterministicEmbeddingProvider();
    const trackedProvider = {
      ...embeddingProvider,
      embedDocuments: (texts: readonly string[]) => {
        embedCalls++;
        return embeddingProvider.embedDocuments(texts);
      },
    };
    const storedHashes = new Map<string, string>();
    const indexer = createIndexer({
      chunker: createRecursiveChunker(),
      embeddingProvider: trackedProvider,
      vectorStore,
      getStoredContentHash: (documentId) => Promise.resolve(storedHashes.get(documentId)),
    });

    const source = textSource({ id: 'src-1', content: 'Unchanging content.' });
    const first = await indexer.index({ source, loader: textLoader });
    expect(first.skipped).toBe(0);
    expect(embedCalls).toBe(1);

    // Simulate persistence recording the hash the first index() run computed.
    const [doc] = await collect(textLoader.load(source));
    if (!doc) throw new Error('expected the loader to produce a document');
    storedHashes.set(doc.id, doc.metadata.contentHash ?? '');

    const second = await indexer.index({ source, loader: textLoader });
    expect(second.skipped).toBe(1);
    expect(second.documentsIndexed).toBe(0);
    expect(embedCalls).toBe(1); // no second embedding call
  });

  it('reindex replaces old chunks rather than accumulating stale duplicates when content shrinks (Section 49)', async () => {
    const { vectorStore } = setup();
    const storedHashes = new Map<string, string>();
    const indexer = createIndexer({
      chunker: createRecursiveChunker({ chunkSize: 20, chunkOverlap: 0 }),
      embeddingProvider: createDeterministicEmbeddingProvider(),
      vectorStore,
      getStoredContentHash: (documentId) => Promise.resolve(storedHashes.get(documentId)),
    });

    const longSource = textSource({
      id: 'src-1',
      content: 'This is a much longer document with many separate sentences that will split into several chunks.',
    });
    const first = await indexer.index({ source: longSource, loader: textLoader });
    expect(first.chunksStored).toBeGreaterThan(1);
    const [longDoc] = await collect(textLoader.load(longSource));
    if (!longDoc) throw new Error('expected the loader to produce a document');
    storedHashes.set(longDoc.id, 'stale-hash-forces-reindex');

    const shortSource = textSource({ id: 'src-1', content: 'Short now.' });
    const second = await indexer.reindex({ source: shortSource, loader: textLoader });
    expect(second.chunksStored).toBeLessThan(first.chunksStored);

    const remaining = await vectorStore.search({ embedding: new Array(32).fill(0), tenantId: undefined, topK: 100 });
    expect(remaining).toHaveLength(second.chunksStored);
  });

  it('delete removes all chunks for a document', async () => {
    const { indexer, vectorStore } = setup();
    const source = textSource({ id: 'src-1', content: 'Some content to delete later.' });
    const result = await indexer.index({ source, loader: textLoader });
    expect(result.chunksStored).toBeGreaterThan(0);

    const [doc] = await collect(textLoader.load(source));
    if (!doc) throw new Error('expected the loader to produce a document');
    await indexer.delete({ tenantId: undefined, documentId: doc.id });

    const remaining = await vectorStore.search({ embedding: new Array(32).fill(0), tenantId: undefined, topK: 100 });
    expect(remaining).toHaveLength(0);
  });

  it('delete requires at least one filter field', async () => {
    const { indexer } = setup();
    await expect(indexer.delete({ tenantId: undefined,})).rejects.toThrow();
  });

  it('records embedding errors in the result without throwing the whole index() call', async () => {
    const vectorStore = createInMemoryVectorStore();
    const failingProvider = {
      ...createDeterministicEmbeddingProvider(),
      embedDocuments: () => Promise.reject(new Error('embedding service down')),
    };
    const indexer = createIndexer({ chunker: createRecursiveChunker(), embeddingProvider: failingProvider, vectorStore });
    const source = textSource({ id: 'src-1', content: 'Some content.' });
    const result = await indexer.index({ source, loader: textLoader });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.chunksStored).toBe(0);
  });
});
