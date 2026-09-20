import type { KnowledgeACL } from '@gixcopilot/knowledge';

/** One embedded chunk as stored in a vector store (Section 41). */
export interface VectorRecord {
  readonly id: string;
  readonly chunkId: string;
  readonly documentId: string;
  readonly sourceId: string;
  readonly tenantId?: string;
  readonly acl?: KnowledgeACL;
  readonly content: string;
  readonly embedding: readonly number[];
  /** Provider/model/dimension/version (Section 40) - lets a retriever refuse to mix incompatible embeddings. */
  readonly embeddingProvider: string;
  readonly embeddingModel: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Constrained, typed filters (Section 58) - never an arbitrary/unsafe filter-execution surface. */
export interface VectorMetadataFilter {
  readonly sourceId?: string | readonly string[];
  readonly documentId?: string | readonly string[];
  readonly tags?: readonly string[];
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  /** Memory expiry pre-filter; records without an expiry are included. */
  readonly expiresAfter?: string;
}

/** Trusted principal used for ACL pre-filtering. Empty means anonymous/public access. */
export interface VectorAccess {
  readonly subject?: string;
  readonly roles?: readonly string[];
  readonly permissions?: readonly string[];
  readonly groups?: readonly string[];
}

export interface VectorList {
  readonly tenantId: string | undefined;
  readonly includeGlobal?: boolean;
  readonly filters?: VectorMetadataFilter;
  readonly limit: number;
  readonly access?: VectorAccess;
  readonly signal?: AbortSignal;
}

export interface VectorSearch {
  readonly embedding: readonly number[];
  /** Mandatory: every search is tenant-scoped (Section 45/59). Pass `undefined` explicitly only for a deliberately global/no-tenant store. */
  readonly tenantId: string | undefined;
  readonly topK: number;
  readonly threshold?: number;
  readonly filters?: VectorMetadataFilter;
  readonly includeGlobal?: boolean;
  readonly access?: VectorAccess;
  readonly embeddingProvider?: string;
  readonly embeddingModel?: string;
  readonly signal?: AbortSignal;
}

export interface VectorSearchResult {
  readonly record: VectorRecord;
  readonly score: number;
}

export interface VectorDeleteFilter {
  /** Exact tenant only. Explicit undefined targets global records, never all tenants. */
  readonly tenantId: string | undefined;
  readonly sourceId?: string;
  readonly documentId?: string;
  readonly chunkIds?: readonly string[];
}

/**
 * Storage-agnostic vector store contract (Section 41) - no pgvector/SQL leaks through this
 * surface; `@gixcopilot/vectorstore-pgvector` and the in-memory implementation below both
 * satisfy it identically.
 */
export interface VectorStore {
  upsert(records: readonly VectorRecord[]): Promise<void>;
  search(query: VectorSearch): Promise<readonly VectorSearchResult[]>;
  delete(filter: VectorDeleteFilter): Promise<void>;
  /** Atomic replacement of one source/document partition, used by the indexer. */
  replace?(filter: VectorDeleteFilter, records: readonly VectorRecord[]): Promise<void>;
  /** Exact metadata lookup/listing without an embedding round trip. */
  list?(query: VectorList): Promise<readonly VectorRecord[]>;
}
