import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { CopilotError } from '@gixcopilot/protocol';
import type { CheckpointListFilter, CheckpointStore, WorkflowCheckpoint } from '@gixcopilot/workflows';
import { workflowRuns } from './schema.js';

export interface CreatePgCheckpointStoreOptions {
  /** One of `connectionString`/`pool` is required. */
  readonly connectionString?: string;
  /** Inject an existing pool (e.g. shared across stores/tests) instead of creating one. */
  readonly pool?: Pool;
}

export interface PgCheckpointStore extends CheckpointStore {
  close(): Promise<void>;
}

type Row = typeof workflowRuns.$inferSelect;

function fromRow<TState>(row: Row): WorkflowCheckpoint<TState> {
  return {
    workflowId: row.workflowId,
    workflowVersion: row.workflowVersion,
    workflowRunId: row.workflowRunId,
    tenantId: row.tenantId ?? undefined,
    status: row.status as WorkflowCheckpoint['status'],
    state: row.state as TState,
    steps: row.steps as WorkflowCheckpoint['steps'],
    pendingApproval: row.pendingApproval ?? undefined,
    error: (row.error as unknown as WorkflowCheckpoint['error']) ?? undefined,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRow<TState>(
  checkpoint: WorkflowCheckpoint<TState>,
  nextVersion: number,
): typeof workflowRuns.$inferInsert {
  return {
    workflowRunId: checkpoint.workflowRunId,
    workflowId: checkpoint.workflowId,
    workflowVersion: checkpoint.workflowVersion,
    tenantId: checkpoint.tenantId ?? null,
    status: checkpoint.status,
    state: checkpoint.state,
    steps: checkpoint.steps,
    pendingApproval: checkpoint.pendingApproval ?? null,
    error: (checkpoint.error as unknown as Record<string, unknown>) ?? null,
    version: nextVersion,
    updatedAt: new Date(),
  };
}

/**
 * PostgreSQL `CheckpointStore` adapter (Section 103, 220) - one of two packages in the
 * workspace allowed to depend on `drizzle-orm`/`pg` (the other is
 * `@gixcopilot/vectorstore-pgvector`), keeping that dependency isolated from
 * `@gixcopilot/workflows` itself (Section 220-221's "core must not require Postgres").
 * `save()` implements the compare-and-swap `CheckpointStore.save()` contract explicitly
 * (Section 226-227): a first save (`checkpoint.version === 0`) inserts; every later save
 * updates only if the stored row's `version` still matches, so two workers racing to resume
 * the same run cannot both win.
 */
export function createPgCheckpointStore(options: CreatePgCheckpointStoreOptions = {}): PgCheckpointStore {
  const pool = options.pool ?? new Pool({ connectionString: options.connectionString ?? process.env['DATABASE_URL'] });
  const db = drizzle(pool);

  return {
    async save<TState>(checkpoint: WorkflowCheckpoint<TState>): Promise<WorkflowCheckpoint<TState>> {
      const nextVersion = checkpoint.version + 1;

      if (checkpoint.version === 0) {
        const existing = await db
          .select({ version: workflowRuns.version })
          .from(workflowRuns)
          .where(eq(workflowRuns.workflowRunId, checkpoint.workflowRunId));
        if (existing.length > 0) {
          throw CopilotError.workflowCheckpointVersionMismatch(
            checkpoint.workflowRunId,
            0,
            existing[0]?.version ?? -1,
          );
        }
        const [inserted] = await db.insert(workflowRuns).values(toRow(checkpoint, nextVersion)).returning();
        if (!inserted) throw CopilotError.workflowCheckpointFailed('Insert returned no row.');
        return fromRow(inserted);
      }

      const updated = await db
        .update(workflowRuns)
        .set(toRow(checkpoint, nextVersion))
        .where(and(eq(workflowRuns.workflowRunId, checkpoint.workflowRunId), eq(workflowRuns.version, checkpoint.version)))
        .returning();

      if (updated.length === 0) {
        const current = await db
          .select({ version: workflowRuns.version })
          .from(workflowRuns)
          .where(eq(workflowRuns.workflowRunId, checkpoint.workflowRunId));
        if (current.length === 0) throw CopilotError.workflowCheckpointNotFound(checkpoint.workflowRunId);
        throw CopilotError.workflowCheckpointVersionMismatch(
          checkpoint.workflowRunId,
          checkpoint.version,
          current[0]?.version ?? -1,
        );
      }
      const [row] = updated;
      if (!row) throw CopilotError.workflowCheckpointFailed('Update returned no row.');
      return fromRow(row);
    },

    async load<TState>(workflowRunId: string): Promise<WorkflowCheckpoint<TState> | undefined> {
      const rows = await db.select().from(workflowRuns).where(eq(workflowRuns.workflowRunId, workflowRunId));
      const row = rows[0];
      return row ? fromRow(row) : undefined;
    },

    async delete(workflowRunId: string): Promise<void> {
      await db.delete(workflowRuns).where(eq(workflowRuns.workflowRunId, workflowRunId));
    },

    async list(filter?: CheckpointListFilter): Promise<readonly WorkflowCheckpoint[]> {
      const conditions = [];
      if (filter?.workflowId !== undefined) conditions.push(eq(workflowRuns.workflowId, filter.workflowId));
      if (filter?.tenantId !== undefined) conditions.push(eq(workflowRuns.tenantId, filter.tenantId));
      const rows =
        conditions.length > 0
          ? await db.select().from(workflowRuns).where(and(...conditions))
          : await db.select().from(workflowRuns);
      return rows.map((row) => fromRow(row));
    },

    async close(): Promise<void> {
      if (!options.pool) await pool.end();
    },
  };
}
