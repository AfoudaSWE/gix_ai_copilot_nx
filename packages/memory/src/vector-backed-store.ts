import { randomUUID } from 'node:crypto';
import { CopilotError } from '@gixcopilot/protocol';
import type { EmbeddingProvider, VectorMetadataFilter, VectorRecord, VectorStore } from '@gixcopilot/rag';
import { validateLimit, validateVector } from '@gixcopilot/rag';
import { memoryExpiry } from './retention.js';
import { isMemoryExpired, memoryOwnerKey, type MemoryOwner, type MemoryRecord, type MemoryType } from './record.js';
import { assertMemoryAccess } from './security.js';
import type {
  MemoryDeleteFilter,
  MemoryGetQuery,
  MemoryPutInput,
  MemorySearchQuery,
  MemorySearchResult,
  MemoryStore,
  MemoryUpdateMode,
} from './store.js';
import { createDefaultMemoryWritePolicy, type MemoryWritePolicy } from './write-policy.js';

export interface CreateVectorBackedMemoryStoreOptions {
  /** Typically `createPgVectorStore({ table: 'memory' })` (Section 98/113/179) - any `VectorStore`
   * works, since this store never depends on pgvector directly (Section 8's package boundary). */
  readonly vectorStore: VectorStore;
  readonly embeddingProvider: EmbeddingProvider;
  readonly writePolicy?: MemoryWritePolicy;
  readonly now?: () => Date;
  readonly dataPolicy?: { redact(data: unknown): unknown };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contentOf(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function toVectorRecord(record: MemoryRecord, embedding: readonly number[], embeddingProvider: EmbeddingProvider): VectorRecord {
  const ownerKey = memoryOwnerKey(record.owner);
  return {
    id: JSON.stringify([ownerKey, record.id]),
    chunkId: record.id,
    documentId: record.type,
    sourceId: ownerKey,
    tenantId: record.tenantId,
    content: contentOf(record.value),
    embedding,
    embeddingProvider: embeddingProvider.provider,
    embeddingModel: embeddingProvider.model,
    metadata: {
      memoryId: record.id,
      owner: record.owner,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ...(record.expiresAt !== undefined ? { expiresAt: record.expiresAt } : {}),
      ...(record.provenance !== undefined ? { provenance: record.provenance } : {}),
      ...(record.derived !== undefined ? { derived: record.derived } : {}),
      ...(typeof record.value !== 'string' ? { value: record.value } : {}),
      ...(record.metadata !== undefined ? { extra: record.metadata } : {}),
    },
  };
}

function fromVectorRecord(vectorRecord: VectorRecord): MemoryRecord {
  const metadata = vectorRecord.metadata ?? {};
  const owner = metadata['owner'] as MemoryOwner;
  const hasStructuredValue = 'value' in metadata;
  return {
    id: (metadata['memoryId'] as string | undefined) ?? vectorRecord.chunkId,
    type: vectorRecord.documentId as MemoryType,
    owner,
    tenantId: vectorRecord.tenantId,
    value: hasStructuredValue ? metadata['value'] : vectorRecord.content,
    createdAt: metadata['createdAt'] as string,
    updatedAt: metadata['updatedAt'] as string,
    expiresAt: metadata['expiresAt'] as string | undefined,
    provenance: metadata['provenance'] as MemoryRecord['provenance'],
    derived: metadata['derived'] as boolean | undefined,
    metadata: metadata['extra'] as Record<string, unknown> | undefined,
  };
}

/**
 * Persistent, similarity-searchable MemoryStore (Section 98/113) built directly on
 * `@gixcopilot/rag`'s storage-agnostic `VectorStore` - the same interface knowledge chunks use,
 * against a separate table/namespace (Section 113/179: `createPgVectorStore({ table: 'memory' })`
 * points at `memory_embeddings`, never `knowledge_chunks`). This is the store for `durable` and
 * `semantic` memory; `working`/`session` memory has no persistence need and should generally use
 * `createInMemoryMemoryStore` instead.
 *
 * `sourceId`/`documentId` are repurposed as `ownerKey`/`memoryType` to fit the shared VectorStore
 * shape without inventing a second storage interface (see vectorstore-pgvector's schema.ts) -
 * every query is pre-filtered by both, so one owner's memories are never visible to a search
 * scoped to a different owner (Section 114), and the store's own `tenantId` filter still applies
 * on top (Section 45/59 applied to memory).
 */
export function createVectorBackedMemoryStore(options: CreateVectorBackedMemoryStoreOptions): MemoryStore {
  const { vectorStore, embeddingProvider } = options;
  const writePolicy = options.writePolicy ?? createDefaultMemoryWritePolicy();
  const now = options.now ?? ((): Date => new Date());
  const list = vectorStore.list?.bind(vectorStore);
  if (!list) throw CopilotError.validation('Persistent memory requires a VectorStore with exact listing support.');

  function readSafe(record: MemoryRecord): MemoryRecord {
    const copy = structuredClone(record);
    return options.dataPolicy ? { ...copy, value: options.dataPolicy.redact(copy.value) } : copy;
  }

  async function findById(id: string, owner: MemoryOwner, tenantId: string | undefined): Promise<MemoryRecord | null> {
    const ownerKey = memoryOwnerKey(owner);
    const filters: VectorMetadataFilter = { sourceId: ownerKey, metadata: { memoryId: id } };
    const results = await vectorStore.list?.({ tenantId, includeGlobal: false, limit: 1, filters });
    const match = results?.[0];
    return match ? fromVectorRecord(match) : null;
  }

  return {
    async put<T = unknown>(input: MemoryPutInput<T>, mode: MemoryUpdateMode = 'replace'): Promise<MemoryRecord<T>> {
      if (input.type === 'working' || input.type === 'session') throw CopilotError.memoryWriteDenied('Working/session memory belongs in a transient store.');
      const decision = await writePolicy.evaluate(input);
      if (!decision.allowed) {
        throw CopilotError.memoryWriteDenied(decision.reason ?? 'Memory write denied by policy.', {
          type: input.type,
        });
      }

      const id = input.id ?? randomUUID();
      // Storage is keyed by `ownerKey::id` (Section 114), so an update lookup is itself
      // owner-scoped: a caller-supplied id that collides with a DIFFERENT owner's record is
      // never found here and therefore never denied - it silently becomes that caller's own,
      // separate record instead. This still cannot leak or overwrite the other owner's memory
      // (their `ownerKey::id` row is untouched); it just means id collision across owners is
      // "always safely partitioned" here rather than "detected and denied" the way the
      // globally-keyed `createInMemoryMemoryStore` treats it. Record ids are randomUUIDs by
      // default, so a real cross-owner collision does not happen in practice.
      let existing: MemoryRecord | null = null;
      if (input.id !== undefined) {
        existing = await findById(id, input.owner, input.tenantId);
        if (existing) assertMemoryAccess(existing, { owner: input.owner, tenantId: input.tenantId }, 'write');
      }
      const usable = existing && !isMemoryExpired(existing, now()) ? existing : undefined;

      const timestamp = now().toISOString();
      const value: T =
        mode === 'merge' && usable && isPlainObject(usable.value) && isPlainObject(input.value)
          ? { ...usable.value, ...input.value }
          : input.value;

      const record: MemoryRecord<T> = {
        id,
        type: input.type,
        owner: input.owner,
        tenantId: input.tenantId,
        value,
        createdAt: usable?.createdAt ?? timestamp,
        updatedAt: timestamp,
        expiresAt: memoryExpiry(input.type, input.expiresAt ?? usable?.expiresAt, now()),
        provenance: input.provenance ?? usable?.provenance,
        derived: input.derived ?? usable?.derived,
        metadata: input.metadata ?? usable?.metadata,
      };

      const finalDecision = await writePolicy.evaluate({ ...input, value, metadata: record.metadata });
      if (!finalDecision.allowed) throw CopilotError.memoryWriteDenied(finalDecision.reason ?? 'Memory write denied by policy.');
      const [embedding] = await embeddingProvider.embedDocuments([contentOf(value)]);
      validateVector(embedding ?? [], embeddingProvider.dimensions);
      await vectorStore.upsert([toVectorRecord(record, embedding ?? [], embeddingProvider)]);
      return structuredClone(record);
    },

    async get(query: MemoryGetQuery): Promise<MemoryRecord | null> {
      const record = await findById(query.id, query.owner, query.tenantId);
      if (!record) return null;
      if (isMemoryExpired(record, now())) {
        await vectorStore.delete({ tenantId: query.tenantId, sourceId: memoryOwnerKey(query.owner), chunkIds: [query.id] });
        return null;
      }
      assertMemoryAccess(record, query, 'read');
      return readSafe(record);
    },

    async search(query: MemorySearchQuery): Promise<readonly MemorySearchResult[]> {
      validateLimit(query.topK ?? 10);
      if (query.text === undefined) {
        const records = await list({ tenantId: query.tenantId, includeGlobal: false, limit: query.topK ?? 10,
          filters: { sourceId: memoryOwnerKey(query.owner), documentId: query.type, expiresAfter: now().toISOString() } });
        return records.map((row) => {
          const record = fromVectorRecord(row);
          assertMemoryAccess(record, query, 'read');
          return { record: readSafe(record) };
        }).filter(({ record }) => !isMemoryExpired(record, now()));
      }
      const ownerKey = memoryOwnerKey(query.owner);
      const embedding = await embeddingProvider.embedQuery(query.text);
      const filters: VectorMetadataFilter = query.type !== undefined
        ? { sourceId: ownerKey, documentId: query.type }
        : { sourceId: ownerKey };

      const results = await vectorStore.search({
        embedding,
        tenantId: query.tenantId,
        topK: query.topK ?? 5,
        threshold: query.threshold,
        filters: { ...filters, expiresAfter: now().toISOString() },
        includeGlobal: false,
        embeddingProvider: embeddingProvider.provider,
        embeddingModel: embeddingProvider.model,
      });

      const mapped: MemorySearchResult[] = [];
      for (const result of results) {
        const record = fromVectorRecord(result.record);
        if (isMemoryExpired(record, now())) continue;
        assertMemoryAccess(record, query, 'read');
        mapped.push({ record: readSafe(record), score: result.score });
      }
      return mapped;
    },

    async delete(filter: MemoryDeleteFilter): Promise<void> {
      if (!filter.owner) throw CopilotError.validation('Memory deletion requires an owner.');
      await vectorStore.delete({
        tenantId: filter.tenantId,
        sourceId: filter.owner !== undefined ? memoryOwnerKey(filter.owner) : undefined,
        documentId: filter.type,
        chunkIds: filter.id !== undefined ? [filter.id] : undefined,
      });
    },
  };
}
