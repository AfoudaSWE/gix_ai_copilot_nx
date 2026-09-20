import { and, cosineDistance, eq, getTableColumns, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { CopilotError } from '@gixcopilot/protocol';
import type { VectorAccess, VectorDeleteFilter, VectorList, VectorRecord, VectorSearch, VectorSearchResult, VectorStore } from '@gixcopilot/rag';
import { validateLimit, validateVector } from '@gixcopilot/rag';
import { EMBEDDING_DIMENSIONS, knowledgeChunks, memoryEmbeddings } from './schema.js';

type VectorTable = typeof knowledgeChunks | typeof memoryEmbeddings;

export interface CreatePgVectorStoreOptions {
  /** One of `connectionString`/`pool` is required. */
  readonly connectionString?: string;
  /** Inject an existing pool (e.g. shared across stores/tests) instead of creating one. */
  readonly pool?: Pool;
  /** Which table set to use - `knowledge` (default) or `memory` (Section 113/179). */
  readonly table?: 'knowledge' | 'memory';
}

/** Owns a pool only when one was not supplied by the caller. */
export interface PgVectorStore extends VectorStore {
  close(): Promise<void>;
}

function toInsertRow(record: VectorRecord): typeof knowledgeChunks.$inferInsert {
  return {
    id: JSON.stringify([record.tenantId ?? null, record.id]),
    chunkId: record.chunkId,
    documentId: record.documentId,
    sourceId: record.sourceId,
    tenantId: record.tenantId ?? null,
    content: record.content,
    embedding: [...record.embedding],
    embeddingProvider: record.embeddingProvider,
    embeddingModel: record.embeddingModel,
    acl: (record.acl as Record<string, unknown> | undefined) ?? null,
    metadata: record.metadata ?? null,
  };
}

function fromRow(row: typeof knowledgeChunks.$inferSelect): VectorRecord {
  return {
    id: (JSON.parse(row.id) as [string | null, string])[1],
    chunkId: row.chunkId,
    documentId: row.documentId,
    sourceId: row.sourceId,
    tenantId: row.tenantId ?? undefined,
    content: row.content,
    embedding: row.embedding,
    embeddingProvider: row.embeddingProvider,
    embeddingModel: row.embeddingModel,
    acl: row.acl ?? undefined,
    metadata: row.metadata ?? undefined,
  };
}

function validateDimensions(record: VectorRecord): void {
  validateVector(record.embedding, EMBEDDING_DIMENSIONS);
  if (record.embedding.length !== EMBEDDING_DIMENSIONS) {
    throw CopilotError.vectorStoreFailed(
      `Embedding for chunk "${record.chunkId}" has ${record.embedding.length} dimensions; this store's schema is fixed at ${EMBEDDING_DIMENSIONS} (Section 178 - a model/dimension change requires a new migration and a full reindex).`,
      { chunkId: record.chunkId, actual: record.embedding.length, expected: EMBEDDING_DIMENSIONS },
    );
  }
}

/**
 * PostgreSQL + pgvector VectorStore adapter (Section 43/44) implementing rag's `VectorStore`
 * interface - the only package in the workspace depending on drizzle-orm/pg (Section 8). ACL/
 * tenant scoping runs in SQL (pre-filter, per the rag skill's "not only post-filtered" rule);
 * @gixcopilot/rag's retriever still applies its own ACL post-filter on top for defense in depth
 * (Section 63) - a vector index is a performance optimization, never the security boundary
 * (the database skill's explicit rule).
 */
export function createPgVectorStore(options: CreatePgVectorStoreOptions = {}): PgVectorStore {
  const pool = options.pool ?? new Pool({ connectionString: options.connectionString ?? process.env['DATABASE_URL'] });
  const db = drizzle(pool);
  const table: VectorTable = options.table === 'memory' ? memoryEmbeddings : knowledgeChunks;

  function tenantCondition(tenantId: string | undefined, includeGlobal = true): SQL {
    // A record with no tenantId is shared/global content, visible to any tenant-scoped query -
    // matches @gixcopilot/rag's in-memory VectorStore and its retriever's defense-in-depth check.
    if (tenantId === undefined) return isNull(table.tenantId);
    if (!includeGlobal) return eq(table.tenantId, tenantId);
    return or(eq(table.tenantId, tenantId), isNull(table.tenantId)) ?? isNull(table.tenantId);
  }

  function aclCondition(access: VectorAccess): SQL {
    const checks: SQL[] = [];
    const grants: SQL[] = [];
    const empty: SQL[] = [];
    const values = { users: access.subject ? [access.subject] : [], roles: access.roles ?? [], permissions: access.permissions ?? [], groups: access.groups ?? [] };
    for (const [field, allowed] of Object.entries(values)) {
      const value = sql`${table.acl}->${field}`;
      checks.push(sql`(${value} IS NULL OR (jsonb_typeof(${value}) = 'array' AND NOT jsonb_path_exists(${value}, '$[*] ? (@.type() != "string" || @ == "")')))`);
      empty.push(sql`(${value} IS NULL OR ${value} = '[]'::jsonb)`);
      grants.push(sql`${value} ?| ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(allowed)}::jsonb))`);
    }
    return sql`(${table.acl} IS NULL OR (jsonb_typeof(${table.acl}) = 'object' AND (${table.acl} - 'users' - 'roles' - 'permissions' - 'groups') = '{}'::jsonb AND ${and(...checks)} AND (${and(...empty)} OR ${or(...grants)})))`;
  }

  function buildConditions(query: Pick<VectorList, 'tenantId' | 'includeGlobal' | 'access' | 'filters'>): SQL[] {
    const conditions: SQL[] = [tenantCondition(query.tenantId, query.includeGlobal)];
    if (query.access !== undefined) conditions.push(aclCondition(query.access));
    const filters = query.filters;
    if (filters?.sourceId !== undefined) {
      const values: readonly string[] = Array.isArray(filters.sourceId) ? filters.sourceId : [filters.sourceId];
      conditions.push(inArray(table.sourceId, [...values]));
    }
    if (filters?.documentId !== undefined) {
      const values: readonly string[] = Array.isArray(filters.documentId) ? filters.documentId : [filters.documentId];
      conditions.push(inArray(table.documentId, [...values]));
    }
    if (filters?.tags !== undefined) {
      conditions.push(sql`${table.metadata}->'tags' ?| ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(filters.tags)}::jsonb))`);
    }
    if (filters?.metadata !== undefined) {
      for (const [key, value] of Object.entries(filters.metadata)) {
        conditions.push(sql`${table.metadata}->${key} = ${JSON.stringify(value)}::jsonb`);
      }
    }
    if (filters?.expiresAfter !== undefined) {
      conditions.push(sql`(${table.metadata}->>'expiresAt' IS NULL OR ${table.metadata}->>'expiresAt' > ${filters.expiresAfter})`);
    }
    return conditions;
  }

  function deleteConditions(filter: VectorDeleteFilter): SQL[] {
    if (!('tenantId' in filter) || (filter.sourceId === undefined && filter.documentId === undefined && filter.chunkIds === undefined)) {
      throw CopilotError.validation('Deletion requires an explicit tenant and a source, document or chunk filter.');
    }
    const conditions: SQL[] = [tenantCondition(filter.tenantId, false)];
    if (filter.sourceId !== undefined) conditions.push(eq(table.sourceId, filter.sourceId));
    if (filter.documentId !== undefined) conditions.push(eq(table.documentId, filter.documentId));
    if (filter.chunkIds !== undefined) conditions.push(inArray(table.chunkId, [...filter.chunkIds]));
    return conditions;
  }

  return {
    async upsert(records: readonly VectorRecord[]): Promise<void> {
      if (records.length === 0) return;
      for (const record of records) validateDimensions(record);
      try {
        await db
          .insert(table)
          .values(records.map(toInsertRow))
          .onConflictDoUpdate({
            target: table.id,
            set: {
              chunkId: sql`excluded.chunk_id`,
              documentId: sql`excluded.document_id`,
              sourceId: sql`excluded.source_id`,
              tenantId: sql`excluded.tenant_id`,
              content: sql`excluded.content`,
              embedding: sql`excluded.embedding`,
              embeddingProvider: sql`excluded.embedding_provider`,
              embeddingModel: sql`excluded.embedding_model`,
              acl: sql`excluded.acl`,
              metadata: sql`excluded.metadata`,
              updatedAt: new Date(),
            },
          });
      } catch {
        throw CopilotError.vectorStoreFailed(`Failed to upsert ${records.length} chunk(s).`);
      }
    },

    async search(query: VectorSearch): Promise<readonly VectorSearchResult[]> {
      query.signal?.throwIfAborted();
      validateLimit(query.topK);
      validateVector(query.embedding, EMBEDDING_DIMENSIONS);
      const distance = cosineDistance(table.embedding, [...query.embedding]).mapWith(Number);
      const conditions = buildConditions(query);
      if (query.embeddingProvider !== undefined) conditions.push(eq(table.embeddingProvider, query.embeddingProvider));
      if (query.embeddingModel !== undefined) conditions.push(eq(table.embeddingModel, query.embeddingModel));
      // Parenthesize the reused distance expression explicitly: pgvector's `<=>` operator has
      // lower precedence than `-`, so `1 - ${distance}` without inner parens was parsed as
      // `(1 - "embedding") <=> $vector` (integer minus vector) instead of `1 - ("embedding" <=> $vector)`.
      if (query.threshold !== undefined) conditions.push(sql`(1 - (${distance})) >= ${query.threshold}`);

      let rows;
      try {
        rows = await db
          .select({ ...getTableColumns(table), distance })
          .from(table)
          .where(and(...conditions))
          .orderBy(distance)
          .limit(query.topK);
      } catch {
        throw CopilotError.vectorStoreFailed('Vector search failed.');
      }
      query.signal?.throwIfAborted();

      return rows.map(({ distance: rowDistance, ...row }) => ({
        record: fromRow(row),
        score: 1 - rowDistance,
      }));
    },

    async delete(filter: VectorDeleteFilter): Promise<void> {
      const conditions = deleteConditions(filter);
      try {
        await db.delete(table).where(and(...conditions));
      } catch {
        throw CopilotError.vectorStoreFailed('Vector deletion failed.');
      }
    },
    async replace(filter, records): Promise<void> {
      const conditions = deleteConditions(filter);
      for (const record of records) {
        validateDimensions(record);
        if (record.tenantId !== filter.tenantId || (filter.documentId !== undefined && record.documentId !== filter.documentId) ||
            (filter.sourceId !== undefined && record.sourceId !== filter.sourceId) || (filter.chunkIds !== undefined && !filter.chunkIds.includes(record.chunkId))) {
          throw CopilotError.validation('Replacement record is outside its partition.');
        }
      }
      try {
        await db.transaction(async (tx) => {
          const partition = JSON.stringify([options.table ?? 'knowledge', filter.tenantId ?? null, filter.sourceId, filter.documentId]);
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${partition}, 0))`);
          await tx.delete(table).where(and(...conditions));
          for (let offset = 0; offset < records.length; offset += 100) {
            await tx.insert(table).values(records.slice(offset, offset + 100).map(toInsertRow));
          }
        });
      } catch {
        throw CopilotError.vectorStoreFailed('Atomic vector replacement failed.');
      }
    },
    async list(query): Promise<readonly VectorRecord[]> {
      query.signal?.throwIfAborted();
      validateLimit(query.limit);
      const rows = await db.select().from(table).where(and(...buildConditions({ ...query, includeGlobal: query.includeGlobal ?? false }))).orderBy(table.id).limit(query.limit);
      query.signal?.throwIfAborted();
      return rows.map(fromRow);
    },
    async close(): Promise<void> {
      if (!options.pool) await pool.end();
    },
  };
}
