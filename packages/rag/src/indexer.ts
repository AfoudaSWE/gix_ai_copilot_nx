import type { DocumentLoader, KnowledgeDocument, KnowledgeSource, LoaderContext } from '@gixcopilot/knowledge';
import { CopilotError } from '@gixcopilot/protocol';
import { randomUUID } from 'node:crypto';
import type { AuditSink } from '@gixcopilot/security';
import { isValidKnowledgeAcl, validateVector } from './vector-security.js';
import { measureKnowledge, type KnowledgeObserver } from './telemetry.js';
import type { Chunker } from './chunker.js';
import type { EmbeddingProvider } from './embeddings/embedding-provider.js';
import type { VectorRecord, VectorStore } from './vectorstore.js';

export interface IndexResult {
  readonly documentsLoaded: number;
  readonly documentsIndexed: number;
  readonly chunksCreated: number;
  readonly chunksEmbedded: number;
  readonly chunksStored: number;
  readonly skipped: number;
  readonly errors: readonly string[];
  readonly durationMs: number;
}

export interface IndexOptions<TConfig = unknown> {
  readonly source: KnowledgeSource<TConfig>;
  readonly loader: DocumentLoader<TConfig>;
  readonly context?: LoaderContext;
}

export interface Indexer {
  index<TConfig = unknown>(options: IndexOptions<TConfig>): Promise<IndexResult>;
  reindex<TConfig = unknown>(options: IndexOptions<TConfig>): Promise<IndexResult>;
  delete(filter: { readonly tenantId: string | undefined; readonly sourceId?: string; readonly documentId?: string }): Promise<void>;
}

export interface CreateIndexerOptions {
  readonly chunker: Chunker;
  readonly embeddingProvider: EmbeddingProvider;
  readonly vectorStore: VectorStore;
  /** Reads a document's currently-stored content hash, if any - enables the idempotent skip-if-unchanged path (Section 131/132). Omit to always reindex. */
  readonly getStoredContentHash?: (documentId: string, tenantId?: string) => Promise<string | undefined>;
  readonly observer?: KnowledgeObserver;
  readonly auditSink?: AuditSink;
}

async function chunkAndEmbed(
  document: KnowledgeDocument,
  chunker: Chunker,
  embeddingProvider: EmbeddingProvider,
  errors: string[],
  signal?: AbortSignal,
  observer?: KnowledgeObserver,
): Promise<{ chunksCreated: number; chunksEmbedded: number; records: VectorRecord[] }> {
  signal?.throwIfAborted();
  const chunks = await measureKnowledge('chunk', observer, () => chunker.chunk(document)).catch((error: unknown) => {
    throw CopilotError.chunkFailed(`Failed to chunk document "${document.id}": ${String(error)}`, {
      documentId: document.id,
    });
  });
  if (chunks.length === 0) {
    return { chunksCreated: 0, chunksEmbedded: 0, records: [] };
  }

  let embeddings: number[][];
  try {
    embeddings = await measureKnowledge('embed.documents', observer, () => embeddingProvider.embedDocuments(chunks.map((chunk) => chunk.content), { signal }));
    signal?.throwIfAborted();
    if (embeddings.length !== chunks.length) throw CopilotError.embeddingFailed('Embedding count does not match chunk count.');
    for (const embedding of embeddings) validateVector(embedding, embeddingProvider.dimensions);
  } catch (error) {
    signal?.throwIfAborted();
    errors.push(`Failed to embed chunks for document "${document.id}": ${String(error)}`);
    return { chunksCreated: chunks.length, chunksEmbedded: 0, records: [] };
  }

  const records: VectorRecord[] = chunks.map((chunk, index) => ({
    id: chunk.id,
    chunkId: chunk.id,
    documentId: chunk.documentId,
    sourceId: chunk.sourceId,
    tenantId: chunk.metadata.tenantId,
    acl: chunk.metadata.acl,
    content: chunk.content,
    embedding: embeddings[index] ?? [],
    embeddingProvider: embeddingProvider.provider,
    embeddingModel: embeddingProvider.model,
    metadata: {
      ...document.metadata.businessMetadata,
      title: chunk.metadata.title,
      uri: chunk.metadata.uri,
      page: chunk.metadata.page,
      section: chunk.metadata.section,
      heading: chunk.metadata.heading,
      position: chunk.metadata.position,
      tags: chunk.metadata.tags,
      contentHash: chunk.metadata.contentHash,
      documentContentHash: document.metadata.contentHash,
    },
  }));

  return { chunksCreated: chunks.length, chunksEmbedded: records.length, records };
}

/**
 * Indexing pipeline (Section 46): Source -> Loader -> Chunker -> EmbeddingProvider -> VectorStore.
 * Reindexing an unchanged document is a no-op (content-hash comparison, Section 131); a changed
 * document has its old chunks fully replaced (Section 49), never left to accumulate stale
 * duplicates.
 */
export function createIndexer(options: CreateIndexerOptions): Indexer {
  const { chunker, embeddingProvider, vectorStore, getStoredContentHash } = options;

  async function runIndex(indexOptions: IndexOptions, forceReindex: boolean): Promise<IndexResult> {
    const start = performance.now();
    let documentsLoaded = 0;
    let documentsIndexed = 0;
    let chunksCreated = 0;
    let chunksEmbedded = 0;
    let chunksStored = 0;
    let skipped = 0;
    const errors: string[] = [];
    const seenDocuments = new Set<string>();

    let documents: AsyncIterable<KnowledgeDocument>;
    try {
      documents = indexOptions.loader.load(indexOptions.source, indexOptions.context);
    } catch (error) {
      throw CopilotError.sourceLoadFailed(`Failed to start loading source "${indexOptions.source.id}": ${String(error)}`, {
        sourceId: indexOptions.source.id,
      });
    }

    try {
      for await (const document of documents) {
        indexOptions.context?.signal?.throwIfAborted();
        if (document.sourceId !== indexOptions.source.id || document.metadata.tenantId !== indexOptions.source.tenantId || !isValidKnowledgeAcl(document.metadata.acl)) {
          throw CopilotError.policyDenied('Loaded document has an invalid source, tenant or ACL.');
        }
        documentsLoaded++;
        seenDocuments.add(document.id);
        const storedHash = getStoredContentHash ? await getStoredContentHash(document.id, document.metadata.tenantId) : undefined;
        // A content hash alone cannot prove ACL, provenance or embedding configuration is unchanged.
        const previous = vectorStore.list ? await vectorStore.list({ tenantId: document.metadata.tenantId, filters: { documentId: document.id }, limit: 1 }) : [];
        const prior = previous[0];
        if (!forceReindex && storedHash !== undefined && storedHash === document.metadata.contentHash && prior &&
            prior.embeddingProvider === embeddingProvider.provider && prior.embeddingModel === embeddingProvider.model &&
            prior.embedding.length === embeddingProvider.dimensions && JSON.stringify(prior.acl) === JSON.stringify(document.metadata.acl) &&
            prior.metadata?.['title'] === document.metadata.title && prior.metadata?.['uri'] === document.metadata.uri) {
          skipped++;
          continue;
        }

        const result = await chunkAndEmbed(document, chunker, embeddingProvider, errors, indexOptions.context?.signal, options.observer);
        chunksCreated += result.chunksCreated;
        chunksEmbedded += result.chunksEmbedded;

        if (result.chunksCreated === 0 || result.records.length > 0) {
          try {
            indexOptions.context?.signal?.throwIfAborted();
            const replace = vectorStore.replace?.bind(vectorStore);
            if (!replace) throw CopilotError.validation('Indexing requires a VectorStore with atomic replace support.');
            await measureKnowledge('index.store', options.observer, () => replace({ tenantId: document.metadata.tenantId, sourceId: document.sourceId, documentId: document.id }, result.records));
            chunksStored += result.records.length;
            documentsIndexed++;
          } catch (error) {
            errors.push(`Failed to store chunks for document "${document.id}": ${String(error)}`);
          }
        }
      }
    } catch (error) {
      if (CopilotError.isCopilotError(error)) throw error;
      throw CopilotError.indexFailed(`Indexing source "${indexOptions.source.id}" failed: ${String(error)}`, {
        sourceId: indexOptions.source.id,
      });
    }

    // An explicit successful reindex is a source synchronization boundary: pages/rows removed
    // from the source must not remain searchable. Failed/partial loads retain previous rows.
    if (forceReindex && errors.length === 0 && vectorStore.list) {
      const existing = await vectorStore.list({ tenantId: indexOptions.source.tenantId, filters: { sourceId: indexOptions.source.id }, limit: 10_000 });
      if (existing.length === 10_000) throw CopilotError.indexFailed('Source synchronization exceeds the 10000-chunk foundation limit; partition the source.');
      for (const documentId of new Set(existing.map((record) => record.documentId))) {
        if (!seenDocuments.has(documentId)) await vectorStore.delete({ tenantId: indexOptions.source.tenantId, sourceId: indexOptions.source.id, documentId });
      }
    }

    await options.auditSink?.write({ id: randomUUID(), timestamp: new Date().toISOString(), tenantId: indexOptions.source.tenantId,
      actor: { kind: 'system' }, action: 'knowledge.index', decision: errors.length ? 'partial' : 'allowed',
      metadata: { sourceId: indexOptions.source.id, documentsIndexed, chunksStored } });
    return {
      documentsLoaded,
      documentsIndexed,
      chunksCreated,
      chunksEmbedded,
      chunksStored,
      skipped,
      errors,
      durationMs: performance.now() - start,
    };
  }

  return {
    index: (indexOptions) => runIndex(indexOptions, false),
    reindex: (indexOptions) => runIndex(indexOptions, true),
    async delete(filter): Promise<void> {
      if (!filter.sourceId && !filter.documentId) {
        throw CopilotError.validation('delete() requires at least one of sourceId/documentId.');
      }
      await vectorStore.delete(filter).catch((error: unknown) => {
        throw CopilotError.vectorStoreFailed(`Failed to delete: ${String(error)}`, filter);
      });
    },
  };
}
