import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { CopilotError } from '@gixcopilot/protocol';
import { assertMemoryAccess, createDefaultMemoryWritePolicy, memoryExpiry } from '@gixcopilot/memory';
import type { MemoryOwner, MemoryRecord, MemoryStore, MemoryWritePolicy } from '@gixcopilot/memory';
import type { DataPolicy } from '@gixcopilot/security';
import { memoryRecords } from './schema.js';

type Row = typeof memoryRecords.$inferSelect;

export interface CreatePostgresMemoryStoreOptions {
  readonly writePolicy?: MemoryWritePolicy;
  readonly dataPolicy?: DataPolicy;
  readonly now?: () => Date;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const tenantEquals = (tenantId: string | undefined): SQL => (tenantId === undefined ? isNull(memoryRecords.tenantId) : eq(memoryRecords.tenantId, tenantId));
const ownerEquals = (owner: MemoryOwner): SQL => and(eq(memoryRecords.ownerType, owner.type), eq(memoryRecords.ownerId, owner.id)) as SQL;

/**
 * Durable PostgreSQL `MemoryStore` for working/session/durable memory (semantic memory keeps
 * using the pgvector-backed store from Phase 9). Same contract as the in-memory store: the
 * default write policy rejects secrets, every read/write is checked with `assertMemoryAccess`,
 * and every query filters by owner AND tenant, so another user's or tenant's memory is never
 * returned. Expired records are invisible and removed lazily.
 */
export function createPostgresMemoryStore(db: NodePgDatabase, options: CreatePostgresMemoryStoreOptions = {}): MemoryStore {
  const writePolicy = options.writePolicy ?? createDefaultMemoryWritePolicy();
  const now = options.now ?? ((): Date => new Date());

  const toRecord = (row: Row): MemoryRecord => {
    const record: MemoryRecord = {
      id: row.id,
      type: row.type as MemoryRecord['type'],
      owner: { type: row.ownerType as MemoryOwner['type'], id: row.ownerId },
      value: row.value,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...(row.tenantId ? { tenantId: row.tenantId } : {}),
      ...(row.expiresAt ? { expiresAt: row.expiresAt.toISOString() } : {}),
      ...(row.provenance ? { provenance: row.provenance as MemoryRecord['provenance'] } : {}),
      ...(row.derived !== null ? { derived: row.derived } : {}),
      ...(row.metadata ? { metadata: row.metadata as Record<string, unknown> } : {}),
    };
    return options.dataPolicy ? { ...record, value: options.dataPolicy.redact(record.value) } : record;
  };
  const live = (): SQL => or(isNull(memoryRecords.expiresAt), gt(memoryRecords.expiresAt, now())) as SQL;

  return {
    async put(input, mode = 'replace') {
      const decision = await writePolicy.evaluate(input);
      if (!decision.allowed) throw CopilotError.memoryWriteDenied(decision.reason ?? 'Memory write denied by policy.', { type: input.type });
      const id = input.id ?? randomUUID();
      const [existingRow] = await db.select().from(memoryRecords).where(and(eq(memoryRecords.id, id), live())).limit(1);
      if (existingRow) assertMemoryAccess(toRecord(existingRow), { owner: input.owner, tenantId: input.tenantId }, 'write');
      const timestamp = now();
      const value =
        mode === 'merge' && existingRow && isPlainObject(existingRow.value) && isPlainObject(input.value) ? { ...existingRow.value, ...input.value } : input.value;
      const metadata = input.metadata ?? (existingRow?.metadata as Record<string, unknown> | undefined);
      const finalDecision = await writePolicy.evaluate({ ...input, value, metadata });
      if (!finalDecision.allowed) throw CopilotError.memoryWriteDenied(finalDecision.reason ?? 'Memory write denied by policy.');
      const expiresAt = memoryExpiry(input.type, input.expiresAt ?? existingRow?.expiresAt?.toISOString(), timestamp);
      const values = {
        id,
        tenantId: input.tenantId ?? null,
        ownerType: input.owner.type,
        ownerId: input.owner.id,
        type: input.type,
        value,
        provenance: input.provenance ?? existingRow?.provenance ?? null,
        derived: input.derived ?? existingRow?.derived ?? null,
        metadata: metadata ?? null,
        createdAt: existingRow?.createdAt ?? timestamp,
        updatedAt: timestamp,
        expiresAt: new Date(expiresAt),
      };
      // An expired row with the same id is replaced; a live row of another owner was rejected above.
      await db.insert(memoryRecords).values(values).onConflictDoUpdate({ target: memoryRecords.id, set: values });
      const [row] = await db.select().from(memoryRecords).where(eq(memoryRecords.id, id)).limit(1);
      if (!row) throw new Error('memory write returned no row');
      return toRecord(row) as MemoryRecord<typeof input.value>;
    },

    async get(query) {
      const [row] = await db.select().from(memoryRecords).where(and(eq(memoryRecords.id, query.id), live())).limit(1);
      if (!row) return null;
      const record = toRecord(row);
      assertMemoryAccess(record, query, 'read');
      return record;
    },

    async search(query) {
      const topK = query.topK ?? 10;
      if (!Number.isInteger(topK) || topK < 1 || topK > 1000) throw CopilotError.validation('topK must be an integer between 1 and 1000.');
      const rows = await db
        .select()
        .from(memoryRecords)
        .where(and(tenantEquals(query.tenantId), ownerEquals(query.owner), live(), ...(query.type ? [eq(memoryRecords.type, query.type)] : [])))
        .orderBy(desc(memoryRecords.updatedAt))
        .limit(topK);
      // Text relevance ranking is the semantic (pgvector) store's job; this store returns the
      // owner's most recent records, exactly like the in-memory store without embeddings.
      return rows.map((row) => ({ record: toRecord(row) }));
    },

    async delete(filter) {
      if (!filter.owner) throw CopilotError.validation('Memory deletion requires an owner.');
      await db
        .delete(memoryRecords)
        .where(
          and(
            tenantEquals(filter.tenantId),
            ownerEquals(filter.owner),
            ...(filter.id ? [eq(memoryRecords.id, filter.id)] : []),
            ...(filter.type ? [eq(memoryRecords.type, filter.type)] : []),
          ),
        );
    },
  };
}
