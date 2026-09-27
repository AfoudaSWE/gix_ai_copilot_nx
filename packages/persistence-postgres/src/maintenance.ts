import { lt, lte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { memoryRecords, runs, threads, usageEvents } from './schema.js';

/**
 * System maintenance for the worker (Section 176-177). These run across tenants on purpose:
 * they apply the operator's configured retention, never a user request, and are exposed only
 * to the worker process (no HTTP route). Audit retention goes through
 * `PostgresAuditSink.purgeBefore`, the only path the audit trigger allows.
 */
export function createMaintenance(db: NodePgDatabase) {
  return {
    /** Deletes memory whose own expiry passed (memory types carry TTLs). */
    async purgeExpiredMemory(now: Date = new Date()): Promise<number> {
      return (await db.delete(memoryRecords).where(lte(memoryRecords.expiresAt, now)).returning({ id: memoryRecords.id })).length;
    },
    /** Deletes threads (and their messages via cascade) not updated since `before`, and their runs. */
    async purgeConversationsBefore(before: Date): Promise<number> {
      return db.transaction(async (tx) => {
        await tx.delete(runs).where(lt(runs.startedAt, before));
        return (await tx.delete(threads).where(lt(threads.updatedAt, before)).returning({ id: threads.id })).length;
      });
    },
    async purgeUsageBefore(before: Date): Promise<number> {
      return (await db.delete(usageEvents).where(lt(usageEvents.occurredAt, before)).returning({ seq: usageEvents.seq })).length;
    },
  };
}

export type Maintenance = ReturnType<typeof createMaintenance>;
