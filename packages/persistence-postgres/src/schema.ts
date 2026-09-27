import { bigint, bigserial, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/*
 * Phase 12 data-plane tables. Every tenant-owned table carries `tenant_id` as the leading
 * key/index column, and repositories only ever query through a tenant-scoped handle. Tenants
 * themselves may be managed by an external identity system, so data tables deliberately do
 * not foreign-key to `tenants`.
 */

const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  metadata: jsonb('metadata'),
  createdAt: created(),
  updatedAt: updated(),
});

export const threads = pgTable(
  'threads',
  {
    tenantId: text('tenant_id').notNull(),
    id: text('id').notNull(),
    projectId: text('project_id'),
    environment: text('environment'),
    subject: text('subject'),
    title: text('title'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.id] }),
    index('threads_tenant_subject_idx').on(table.tenantId, table.subject, table.updatedAt),
    index('threads_tenant_project_idx').on(table.tenantId, table.projectId, table.environment, table.updatedAt),
  ],
);

export const messages = pgTable(
  'messages',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    threadId: text('thread_id').notNull(),
    id: text('id').notNull(),
    role: text('role').notNull(),
    content: jsonb('content').notNull(),
    runId: text('run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('messages_tenant_id_uq').on(table.tenantId, table.id),
    index('messages_tenant_thread_idx').on(table.tenantId, table.threadId, table.seq),
  ],
);

export const runs = pgTable(
  'runs',
  {
    tenantId: text('tenant_id').notNull(),
    id: text('id').notNull(),
    threadId: text('thread_id'),
    projectId: text('project_id'),
    environment: text('environment'),
    subject: text('subject'),
    status: text('status').notNull(),
    modelProvider: text('model_provider'),
    modelName: text('model_name'),
    usage: jsonb('usage'),
    errorCode: text('error_code'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.id] }),
    index('runs_tenant_started_idx').on(table.tenantId, table.startedAt),
    index('runs_tenant_thread_idx').on(table.tenantId, table.threadId),
    index('runs_tenant_status_idx').on(table.tenantId, table.status),
  ],
);

export const memoryRecords = pgTable(
  'memory_records',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id'),
    ownerType: text('owner_type').notNull(),
    ownerId: text('owner_id').notNull(),
    type: text('type').notNull(),
    value: jsonb('value').notNull(),
    provenance: text('provenance'),
    derived: boolean('derived'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    index('memory_tenant_owner_idx').on(table.tenantId, table.ownerType, table.ownerId, table.type, table.updatedAt),
    index('memory_expires_idx').on(table.expiresAt),
  ],
);

export const auditRecords = pgTable(
  'audit_records',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    id: text('id').notNull(),
    tenantId: text('tenant_id'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    actorKind: text('actor_kind').notNull(),
    actorSubject: text('actor_subject'),
    action: text('action').notNull(),
    tool: text('tool'),
    runId: text('run_id'),
    toolCallId: text('tool_call_id'),
    decision: text('decision').notNull(),
    approval: jsonb('approval'),
    resultStatus: text('result_status'),
    metadata: jsonb('metadata'),
  },
  (table) => [
    uniqueIndex('audit_id_uq').on(table.id),
    index('audit_tenant_time_idx').on(table.tenantId, table.timestamp),
    index('audit_tenant_actor_idx').on(table.tenantId, table.actorSubject, table.timestamp),
    index('audit_tenant_action_idx').on(table.tenantId, table.action, table.timestamp),
    index('audit_tenant_run_idx').on(table.tenantId, table.runId),
  ],
);

export const usageEvents = pgTable(
  'usage_events',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    id: text('id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    projectId: text('project_id'),
    environment: text('environment'),
    subject: text('subject'),
    runId: text('run_id'),
    kind: text('kind').notNull(),
    provider: text('provider'),
    model: text('model'),
    agentId: text('agent_id'),
    tool: text('tool'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    count: integer('count').notNull().default(1),
    latencyMs: integer('latency_ms'),
    estimatedCostMicros: bigint('estimated_cost_micros', { mode: 'number' }),
    metadata: jsonb('metadata'),
  },
  (table) => [
    uniqueIndex('usage_tenant_id_uq').on(table.tenantId, table.id),
    index('usage_tenant_time_idx').on(table.tenantId, table.occurredAt),
    index('usage_tenant_project_time_idx').on(table.tenantId, table.projectId, table.environment, table.occurredAt),
    index('usage_tenant_model_time_idx').on(table.tenantId, table.model, table.occurredAt),
  ],
);

/** Applied-migration bookkeeping (created by the migrator, not by a migration). */
export const MIGRATIONS_TABLE = 'aicopilot_migrations';

/* Control plane (Phase 12 Section 79-102). */

export const projects = pgTable(
  'projects',
  {
    tenantId: text('tenant_id').notNull(),
    id: text('id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    status: text('status').notNull().default('active'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] }), uniqueIndex('projects_tenant_slug_uq').on(table.tenantId, table.slug)],
);

export const environments = pgTable(
  'environments',
  {
    tenantId: text('tenant_id').notNull(),
    id: text('id').notNull(),
    projectId: text('project_id').notNull(),
    name: text('name').notNull(),
    production: boolean('production').notNull().default(false),
    createdAt: created(),
    updatedAt: updated(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] }), uniqueIndex('environments_project_name_uq').on(table.tenantId, table.projectId, table.name)],
);

export const memberships = pgTable(
  'memberships',
  {
    tenantId: text('tenant_id').notNull(),
    subject: text('subject').notNull(),
    role: text('role').notNull(),
    projectIds: jsonb('project_ids'),
    createdAt: created(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.subject] })],
);

export const resources = pgTable(
  'resources',
  {
    tenantId: text('tenant_id').notNull(),
    id: text('id').notNull(),
    projectId: text('project_id'),
    environment: text('environment'),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    currentVersion: integer('current_version').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: created(),
    updatedAt: updated(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.id] }),
    index('resources_tenant_kind_idx').on(table.tenantId, table.kind),
  ],
);

export const resourceVersions = pgTable(
  'resource_versions',
  {
    tenantId: text('tenant_id').notNull(),
    resourceId: text('resource_id').notNull(),
    version: integer('version').notNull(),
    spec: jsonb('spec').notNull(),
    stage: text('stage').notNull().default('draft'),
    createdBy: text('created_by').notNull(),
    createdAt: created(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.resourceId, table.version] })],
);

/** Ciphertext only (AES-256-GCM, tenant+name bound as AAD). Never plaintext. */
export const secrets = pgTable(
  'secrets',
  {
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    tag: text('tag').notNull(),
    keyVersion: text('key_version').notNull(),
    updatedAt: updated(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.name] })],
);

/** HITL approvals shared by every API instance (Phase 7 semantics, durable). */
export const approvals = pgTable(
  'approvals',
  {
    approvalId: text('approval_id').primaryKey(),
    tenantId: text('tenant_id'),
    runId: text('run_id').notNull(),
    status: text('status').notNull(),
    revision: integer('revision').notNull().default(0),
    request: jsonb('request').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (table) => [index('approvals_tenant_status_idx').on(table.tenantId, table.status), index('approvals_run_idx').on(table.runId)],
);
