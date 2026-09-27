import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { AuditRecord, AuditSink } from '@gixcopilot/security';
import { assertValidId, pageSize } from '@gixcopilot/tenancy';
import type { Page, RuntimeScope } from '@gixcopilot/tenancy';
import { auditRecords } from './schema.js';

export interface AuditQuery {
  readonly actor?: string;
  readonly action?: string;
  readonly decision?: string;
  readonly runId?: string;
  readonly tool?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ScopedAuditReader {
  search(query?: AuditQuery): Promise<Page<AuditRecord>>;
}

export interface PostgresAuditSink extends AuditSink {
  /** Tenant-scoped, read-only audit search (Section 100). There is no update or delete API. */
  forTenant(scope: RuntimeScope): ScopedAuditReader;
  /**
   * Retention purge: deletes records older than `before` for one tenant, through the database
   * trigger's explicit opt-in. The only deletion path; run it from a scheduled maintenance job
   * according to your documented audit-retention period.
   */
  purgeBefore(scope: RuntimeScope, before: Date): Promise<number>;
}

/**
 * Durable, append-only audit sink. Writes are idempotent by record id; the table's trigger
 * rejects UPDATE and any DELETE outside `purgeBefore`, so audit stays immutable even against
 * direct SQL mistakes in application code.
 */
export function createPostgresAuditSink(db: NodePgDatabase): PostgresAuditSink {
  return {
    async write(record) {
      await db
        .insert(auditRecords)
        .values({
          id: record.id,
          tenantId: record.tenantId ?? null,
          timestamp: new Date(record.timestamp),
          actorKind: record.actor.kind,
          actorSubject: record.actor.subject ?? null,
          action: record.action,
          tool: record.tool ?? null,
          runId: record.runId ?? null,
          toolCallId: record.toolCallId ?? null,
          decision: record.decision,
          approval: record.approval ?? null,
          resultStatus: record.resultStatus ?? null,
          metadata: record.metadata ?? null,
        })
        .onConflictDoNothing();
    },
    forTenant(scope) {
      const tenantId = assertValidId(scope.tenantId, 'tenant id');
      return {
        async search(query = {}) {
          const size = pageSize(query.limit);
          const before = query.cursor ? Number.parseInt(query.cursor, 10) : undefined;
          const conditions: SQL[] = [eq(auditRecords.tenantId, tenantId)];
          if (query.actor) conditions.push(eq(auditRecords.actorSubject, query.actor));
          if (query.action) conditions.push(eq(auditRecords.action, query.action));
          if (query.decision) conditions.push(eq(auditRecords.decision, query.decision));
          if (query.runId) conditions.push(eq(auditRecords.runId, query.runId));
          if (query.tool) conditions.push(eq(auditRecords.tool, query.tool));
          if (query.from) conditions.push(gte(auditRecords.timestamp, new Date(query.from)));
          if (query.to) conditions.push(lte(auditRecords.timestamp, new Date(query.to)));
          if (before !== undefined && Number.isFinite(before)) conditions.push(sql`${auditRecords.seq} < ${before}`);
          const rows = await db.select().from(auditRecords).where(and(...conditions)).orderBy(desc(auditRecords.seq)).limit(size + 1);
          const page = rows.slice(0, size);
          const last = page.at(-1);
          return {
            items: page.map(
              (row): AuditRecord => ({
                id: row.id,
                timestamp: row.timestamp.toISOString(),
                actor: { kind: row.actorKind as AuditRecord['actor']['kind'], ...(row.actorSubject ? { subject: row.actorSubject } : {}) },
                action: row.action,
                decision: row.decision,
                ...(row.tenantId ? { tenantId: row.tenantId } : {}),
                ...(row.tool ? { tool: row.tool } : {}),
                ...(row.runId ? { runId: row.runId } : {}),
                ...(row.toolCallId ? { toolCallId: row.toolCallId } : {}),
                ...(row.approval ? { approval: row.approval as AuditRecord['approval'] } : {}),
                ...(row.resultStatus ? { resultStatus: row.resultStatus as AuditRecord['resultStatus'] } : {}),
                ...(row.metadata ? { metadata: row.metadata as Record<string, unknown> } : {}),
              }),
            ),
            ...(rows.length > size && last ? { nextCursor: String(last.seq) } : {}),
          };
        },
      };
    },
    async purgeBefore(scope, before) {
      const tenantId = assertValidId(scope.tenantId, 'tenant id');
      return db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL aicopilot.audit_retention_purge = 'on'`);
        const deleted = await tx.delete(auditRecords).where(and(eq(auditRecords.tenantId, tenantId), lte(auditRecords.timestamp, before))).returning({ seq: auditRecords.seq });
        return deleted.length;
      });
    },
  };
}
