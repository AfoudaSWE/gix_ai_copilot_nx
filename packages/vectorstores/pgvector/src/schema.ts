import { index, jsonb, pgTable, text, timestamp, vector } from 'drizzle-orm/pg-core';

/**
 * Fixed at schema/migration time (Section 39/178) - pgvector requires a column-level dimension
 * count. Changing embedding models/dimensions requires a new migration and a full reindex; this
 * package's `createPgVectorStore` validates the configured EmbeddingProvider's dimensions
 * against this constant at construction time rather than silently storing truncated/padded
 * vectors.
 */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * One row per embedded chunk (Section 44/180). Deliberately separate from `memoryEmbeddings`
 * below (Section 179 - "keep memory records separated logically from knowledge chunks") even
 * though both reuse the same `VectorStore` interface (ADR: memory reuses rag's vector
 * abstraction with its own table, not knowledge's).
 */
export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: text('id').primaryKey(),
    chunkId: text('chunk_id').notNull(),
    documentId: text('document_id').notNull(),
    sourceId: text('source_id').notNull(),
    tenantId: text('tenant_id'),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    embeddingProvider: text('embedding_provider').notNull(),
    embeddingModel: text('embedding_model').notNull(),
    acl: jsonb('acl').$type<Record<string, unknown> | null>(),
    metadata: jsonb('metadata').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('knowledge_chunks_tenant_idx').on(table.tenantId),
    index('knowledge_chunks_document_idx').on(table.documentId),
    index('knowledge_chunks_source_idx').on(table.sourceId),
    // The ANN vector index itself (HNSW, pgvector cosine ops) is created by hand-written SQL in
    // the migrations/ directory, not by drizzle-kit's generic index builder - see
    // migrations/0000_init.sql for the operator-class-specific CREATE INDEX statement.
  ],
);

/**
 * Durable/semantic memory storage (Section 113/179) - a distinct table set from knowledge, used
 * by `@gixcopilot/memory`'s `createVectorBackedMemoryStore` via the same `VectorStore` interface,
 * with `sourceId`/`documentId` repurposed as `ownerId`/`memoryType` to fit the shared shape
 * without inventing a second interface.
 */
export const memoryEmbeddings = pgTable(
  'memory_embeddings',
  {
    id: text('id').primaryKey(),
    chunkId: text('chunk_id').notNull(),
    documentId: text('document_id').notNull(),
    sourceId: text('source_id').notNull(),
    tenantId: text('tenant_id'),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    embeddingProvider: text('embedding_provider').notNull(),
    embeddingModel: text('embedding_model').notNull(),
    acl: jsonb('acl').$type<Record<string, unknown> | null>(),
    metadata: jsonb('metadata').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('memory_embeddings_tenant_idx').on(table.tenantId),
    index('memory_embeddings_document_idx').on(table.documentId),
    index('memory_embeddings_source_idx').on(table.sourceId),
  ],
);
