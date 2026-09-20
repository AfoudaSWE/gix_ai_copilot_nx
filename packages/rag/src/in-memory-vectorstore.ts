import type {
  VectorDeleteFilter,
  VectorMetadataFilter,
  VectorRecord,
  VectorSearch,
  VectorSearchResult,
  VectorStore,
} from './vectorstore.js';
import { CopilotError } from '@gixcopilot/protocol';
import { matchesKnowledgeAcl, validateLimit, validateVector } from './vector-security.js';

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function matchesFilters(record: VectorRecord, filters: VectorMetadataFilter | undefined): boolean {
  if (!filters) return true;
  if (filters.expiresAfter !== undefined) {
    const expiry = record.metadata?.['expiresAt'];
    if (expiry !== undefined && (typeof expiry !== 'string' || !(Date.parse(expiry) > Date.parse(filters.expiresAfter)))) return false;
  }
  if (filters.sourceId !== undefined) {
    const allowed = Array.isArray(filters.sourceId) ? filters.sourceId : [filters.sourceId];
    if (!allowed.includes(record.sourceId)) return false;
  }
  if (filters.documentId !== undefined) {
    const allowed = Array.isArray(filters.documentId) ? filters.documentId : [filters.documentId];
    if (!allowed.includes(record.documentId)) return false;
  }
  if (filters.tags !== undefined) {
    const recordTags = (record.metadata?.['tags'] as readonly string[] | undefined) ?? [];
    if (!filters.tags.some((tag) => recordTags.includes(tag))) return false;
  }
  if (filters.metadata !== undefined) {
    for (const [key, value] of Object.entries(filters.metadata)) {
      if (record.metadata?.[key] !== value) return false;
    }
  }
  return true;
}

/**
 * Deterministic, dependency-free VectorStore for unit tests and small examples (Section 42) -
 * not a production recommendation (that's `@gixcopilot/vectorstore-pgvector`). Tenant scoping
 * runs as a real pre-filter here too, mirroring the query-level enforcement a real database
 * adapter must do (the rag skill's "not only post-filtered in application code" rule), so tests
 * against this store exercise the same tenant-isolation guarantee production code relies on.
 */
export function createInMemoryVectorStore(): VectorStore {
  const records = new Map<string, VectorRecord>();
  const keyOf = (record: VectorRecord): string => JSON.stringify([record.tenantId ?? null, record.id]);
  function matchesDelete(record: VectorRecord, filter: VectorDeleteFilter): boolean {
    return record.tenantId === filter.tenantId &&
      (filter.sourceId === undefined || record.sourceId === filter.sourceId) &&
      (filter.documentId === undefined || record.documentId === filter.documentId) &&
      (filter.chunkIds === undefined || filter.chunkIds.includes(record.chunkId));
  }
  function validateDelete(filter: VectorDeleteFilter): void {
    if (!('tenantId' in filter) || (filter.sourceId === undefined && filter.documentId === undefined && filter.chunkIds === undefined)) {
      throw CopilotError.validation('Deletion requires an explicit tenant and a source, document or chunk filter.');
    }
  }

  return {
    // eslint-disable-next-line @typescript-eslint/require-await -- VectorStore is async so a real network-backed store fits the same interface
    async upsert(newRecords: readonly VectorRecord[]): Promise<void> {
      for (const record of newRecords) validateVector(record.embedding);
      for (const record of newRecords) {
        records.set(keyOf(record), structuredClone(record));
      }
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async search(query: VectorSearch): Promise<readonly VectorSearchResult[]> {
      query.signal?.throwIfAborted();
      validateLimit(query.topK);
      validateVector(query.embedding);
      // A record with no tenantId is treated as shared/global content, visible to every
      // tenant-scoped query (Section 45/59) - matches the retriever's own defense-in-depth
      // tenantMatches() check, so that check isn't dead code once results reach it.
      const candidates = [...records.values()].filter(
        (record) =>
          (record.tenantId === query.tenantId || (query.includeGlobal !== false && record.tenantId === undefined)) &&
          (query.access === undefined || matchesKnowledgeAcl(record.acl, query.access)) &&
          record.embedding.length === query.embedding.length &&
          (query.embeddingProvider === undefined || record.embeddingProvider === query.embeddingProvider) &&
          (query.embeddingModel === undefined || record.embeddingModel === query.embeddingModel) &&
          matchesFilters(record, query.filters),
      );
      const scored = candidates
        .map((record) => ({ record, score: cosineSimilarity(record.embedding, query.embedding) }))
        .filter((result) => query.threshold === undefined || result.score >= query.threshold)
        .sort((a, b) => b.score - a.score);
      return structuredClone(scored.slice(0, query.topK));
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async delete(filter: VectorDeleteFilter): Promise<void> {
      validateDelete(filter);
      for (const [id, record] of records) {
        if (matchesDelete(record, filter)) {
          records.delete(id);
        }
      }
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async replace(filter, replacement): Promise<void> {
      validateDelete(filter);
      for (const record of replacement) {
        validateVector(record.embedding);
        if (!matchesDelete(record, filter)) throw CopilotError.validation('Replacement record is outside its partition.');
      }
      for (const [id, record] of records) if (matchesDelete(record, filter)) records.delete(id);
      for (const record of replacement) records.set(keyOf(record), structuredClone(record));
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async list(query): Promise<readonly VectorRecord[]> {
      query.signal?.throwIfAborted();
      validateLimit(query.limit);
      return structuredClone([...records.values()].filter((record) =>
        (record.tenantId === query.tenantId || (query.includeGlobal === true && record.tenantId === undefined)) &&
        (query.access === undefined || matchesKnowledgeAcl(record.acl, query.access)) &&
        matchesFilters(record, query.filters),
      ).sort((a, b) => a.id.localeCompare(b.id)).slice(0, query.limit));
    },
  };
}
