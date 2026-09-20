import { randomUUID } from 'node:crypto';
import { CopilotError } from '@gixcopilot/protocol';
import type { EmbeddingProvider } from '@gixcopilot/rag';
import { validateLimit, validateVector } from '@gixcopilot/rag';
import { isMemoryExpired, memoryOwnersEqual, type MemoryOwner, type MemoryRecord } from './record.js';
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
import { memoryExpiry } from './retention.js';

export interface CreateInMemoryMemoryStoreOptions {
  readonly writePolicy?: MemoryWritePolicy;
  /** Enables similarity search for `search({ text })` queries (Section 93/113); without it,
   * `search()` falls back to a most-recently-updated listing scoped to owner/type. */
  readonly embeddingProvider?: EmbeddingProvider;
  readonly now?: () => Date;
  readonly dataPolicy?: { redact(data: unknown): unknown };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

function contentOf(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Deterministic, dependency-free MemoryStore for unit tests and small examples (Section 97) -
 * the memory analogue of `@gixcopilot/rag`'s `createInMemoryVectorStore`. Suitable for working/
 * session memory (no persistence needed) and as a test double for durable/semantic memory.
 */
export function createInMemoryMemoryStore(options: CreateInMemoryMemoryStoreOptions = {}): MemoryStore {
  const records = new Map<string, MemoryRecord>();
  const embeddings = new Map<string, readonly number[]>();
  const writePolicy = options.writePolicy ?? createDefaultMemoryWritePolicy();
  const now = options.now ?? ((): Date => new Date());

  function ownedBy(record: MemoryRecord, owner: MemoryOwner): boolean {
    return memoryOwnersEqual(record.owner, owner);
  }

  function expireIfNeeded(record: MemoryRecord): boolean {
    if (!isMemoryExpired(record, now())) return false;
    records.delete(record.id);
    embeddings.delete(record.id);
    return true;
  }

  return {
    async put<T = unknown>(input: MemoryPutInput<T>, mode: MemoryUpdateMode = 'replace'): Promise<MemoryRecord<T>> {
      const decision = await writePolicy.evaluate(input);
      if (!decision.allowed) {
        throw CopilotError.memoryWriteDenied(decision.reason ?? 'Memory write denied by policy.', {
          type: input.type,
        });
      }

      const id = input.id ?? randomUUID();
      const existing = records.get(id);
      if (existing && !expireIfNeeded(existing)) {
        assertMemoryAccess(existing, { owner: input.owner, tenantId: input.tenantId }, 'write');
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
      if (options.embeddingProvider) {
        const [embedding] = await options.embeddingProvider.embedDocuments([contentOf(value)]);
        validateVector(embedding ?? [], options.embeddingProvider.dimensions);
        if (embedding) embeddings.set(id, embedding);
      }
      records.set(id, structuredClone(record));
      return structuredClone(record);
    },

    // eslint-disable-next-line @typescript-eslint/require-await -- MemoryStore is async so a persistent store's real I/O fits the same interface
    async get(query: MemoryGetQuery): Promise<MemoryRecord | null> {
      const record = records.get(query.id);
      if (!record) return null;
      if (expireIfNeeded(record)) return null;
      assertMemoryAccess(record, query, 'read');
      return readSafe(record);
    },

    async search(query: MemorySearchQuery): Promise<readonly MemorySearchResult[]> {
      const topK = query.topK ?? 10;
      validateLimit(topK);
      const candidates = [...records.values()].filter((record) => {
        if (isMemoryExpired(record, now())) return false;
        if (!ownedBy(record, query.owner)) return false;
        if (record.tenantId !== query.tenantId) return false;
        if (query.type !== undefined && record.type !== query.type) return false;
        return true;
      });

      if (query.text !== undefined && options.embeddingProvider) {
        const queryEmbedding = await options.embeddingProvider.embedQuery(query.text);
        return candidates
          .map((record) => ({ record, score: cosineSimilarity(embeddings.get(record.id) ?? [], queryEmbedding) }))
          .filter((result) => query.threshold === undefined || result.score >= query.threshold)
          .sort((a, b) => b.score - a.score)
          .slice(0, topK).map((result) => ({ ...result, record: readSafe(result.record) }));
      }

      return candidates
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, topK)
        .map((record) => ({ record: readSafe(record) }));
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async delete(filter: MemoryDeleteFilter): Promise<void> {
      if (!filter.owner) throw CopilotError.validation('Memory deletion requires an owner.');
      for (const [id, record] of records) {
        if (filter.id !== undefined && id !== filter.id) continue;
        if (filter.owner !== undefined && !ownedBy(record, filter.owner)) continue;
        if (record.tenantId !== filter.tenantId) continue;
        if (filter.type !== undefined && record.type !== filter.type) continue;
        records.delete(id);
        embeddings.delete(id);
      }
    },
  };

  function readSafe(record: MemoryRecord): MemoryRecord {
    const copy = structuredClone(record);
    return options.dataPolicy ? { ...copy, value: options.dataPolicy.redact(copy.value) } : copy;
  }
}
