import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * One row per workflow run (Section 100-104), the current-state projection a
 * `CheckpointStore` needs - not an append-only history table (that belongs to a future
 * observability/devtools phase, per the agent-architecture/redis-jobs skills' "don't build
 * the replay UI yet"). `version` is the optimistic-concurrency column
 * `pg-checkpoint-store.ts`'s compare-and-swap `save()` reads/writes (Section 226-227).
 */
export const workflowRuns = pgTable(
  'workflow_runs',
  {
    workflowRunId: text('workflow_run_id').primaryKey(),
    workflowId: text('workflow_id').notNull(),
    workflowVersion: text('workflow_version').notNull(),
    tenantId: text('tenant_id'),
    status: text('status').notNull(),
    state: jsonb('state').$type<unknown>(),
    steps: jsonb('steps').$type<readonly unknown[]>().notNull().default([]),
    pendingApproval: jsonb('pending_approval').$type<{ stepId: string; approvalId: string } | null>(),
    error: jsonb('error').$type<Record<string, unknown> | null>(),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('workflow_runs_workflow_idx').on(table.workflowId),
    index('workflow_runs_tenant_idx').on(table.tenantId),
    index('workflow_runs_status_idx').on(table.status),
  ],
);
