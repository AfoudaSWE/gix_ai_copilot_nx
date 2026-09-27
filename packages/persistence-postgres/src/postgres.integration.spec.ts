import { execSync } from 'node:child_process';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createPgCheckpointStore } from '@gixcopilot/checkpoint-postgres';
import { createCopilot } from '@gixcopilot/node';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { createRetriever } from '@gixcopilot/rag';
import type { EmbeddingProvider, VectorRecord } from '@gixcopilot/rag';
import { createInMemoryApprovalStore, createStaticAuthenticationAdapter } from '@gixcopilot/security';
import type { AuditRecord, Identity, SecurityContext } from '@gixcopilot/security';
import { createConversationRecorder } from '@gixcopilot/tenancy';
import { createPgVectorStore } from '@gixcopilot/vectorstore-pgvector';
import { approvalStep, createWorkflowEngine, defineWorkflow, functionStep } from '@gixcopilot/workflows';
import { randomBytes } from 'node:crypto';
import { createEncryptedSecretStore, createManagementService } from '@gixcopilot/management';
import { createInMemoryAuditSink as createAuditMemory } from '@gixcopilot/security';
import { builtInMigrationSources, createPostgresPersistence, loadMigrations } from './index.js';
import type { PostgresPersistence } from './index.js';

/**
 * Phase 12 Section 47/182 (mandatory): Tenant A and Tenant B against a REAL PostgreSQL with
 * pgvector, across every persistent subsystem. Skips only when Docker is unreachable.
 */
function dockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const A: SecurityContext = { identity: { subject: 'alice', roles: [], permissions: ['approvals.supervisor'], attributes: { tenantId: 'tenant-a' } }, tenant: { tenantId: 'tenant-a' } };
const B: SecurityContext = { identity: { subject: 'bob', roles: [], permissions: ['approvals.supervisor'], attributes: { tenantId: 'tenant-b' } }, tenant: { tenantId: 'tenant-b' } };

/** Deterministic 1536-dim embeddings (the pgvector column size), clearly a test double. */
const embeddings: EmbeddingProvider = {
  provider: 'test',
  model: 'hash-1536',
  dimensions: 1536,
  embedDocuments: (texts) => Promise.resolve(texts.map((text) => vector(text))),
  embedQuery: (text) => Promise.resolve(vector(text)),
};
function vector(text: string): number[] {
  const out = new Array<number>(1536).fill(0);
  for (const word of text.toLowerCase().split(/\W+/).filter(Boolean)) {
    let hash = 0;
    for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    out[hash % 1536] = (out[hash % 1536] ?? 0) + 1;
  }
  return out;
}

describe.skipIf(!dockerAvailable())('persistence-postgres against real PostgreSQL + pgvector', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let persistence: PostgresPersistence;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    pool = new Pool({ connectionString: container.getConnectionUri(), max: 8 });
    persistence = createPostgresPersistence({ pool });
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('migrations: apply in order, are idempotent, detect edits, and roll back only with a reviewed down file', async () => {
    const before = await persistence.migrator.status();
    expect(before.every((migration) => !migration.applied)).toBe(true);
    expect((await persistence.health({ checkMigrations: true })).ok).toBe(false);

    // Two instances migrating at once: the advisory lock serializes them.
    const [first, second] = await Promise.all([persistence.migrator.up(), createPostgresPersistence({ pool }).migrator.up()]);
    expect([...first, ...second].sort()).toEqual(before.map((migration) => migration.id).sort());
    expect(await persistence.migrator.up()).toEqual([]);
    expect(await persistence.health({ checkMigrations: true })).toMatchObject({ ok: true, pendingMigrations: 0 });

    await pool.query(`UPDATE aicopilot_migrations SET checksum = 'tampered' WHERE id = 'checkpoints/0000_init.sql'`);
    await expect(persistence.migrator.up()).rejects.toThrow(/were modified/);
    const status = await persistence.migrator.status();
    expect(status.find((migration) => migration.id === 'checkpoints/0000_init.sql')?.modified).toBe(true);
    // Restore the real checksum by re-reading it from the loader.
    const real = (await loadMigrations(builtInMigrationSources())).find((migration) => migration.id === 'checkpoints/0000_init.sql');
    await pool.query(`UPDATE aicopilot_migrations SET checksum = $1 WHERE id = 'checkpoints/0000_init.sql'`, [real?.checksum]);

    // The platform migrations have reviewed down files; roll them back and re-apply.
    expect(await persistence.migrator.rollbackLast()).toBe('platform/0002_approvals.sql');
    expect(await persistence.migrator.rollbackLast()).toBe('platform/0001_control_plane.sql');
    expect(await persistence.migrator.rollbackLast()).toBe('platform/0000_platform.sql');
    expect((await pool.query(`SELECT to_regclass('public.threads') AS t`)).rows[0]).toEqual({ t: null });
    expect(await persistence.migrator.up()).toEqual(['platform/0000_platform.sql', 'platform/0001_control_plane.sql', 'platform/0002_approvals.sql']);
    // pgvector's migration has no down file: rollback refuses instead of guessing.
    await persistence.migrator.rollbackLast();
    await persistence.migrator.rollbackLast();
    await persistence.migrator.rollbackLast();
    await expect(persistence.migrator.rollbackLast()).rejects.toThrow(/no reviewed .down.sql/);
    await persistence.migrator.up();
  });

  it('threads, messages and runs: Tenant A cannot read Tenant B conversations', async () => {
    const a = persistence.conversations.forTenant({ tenantId: 'tenant-a' });
    const b = persistence.conversations.forTenant({ tenantId: 'tenant-b' });
    await a.upsertThread({ id: 'shared-id', subject: 'alice', title: 'A thread' });
    await b.upsertThread({ id: 'shared-id', subject: 'bob', title: 'B thread' });
    await a.appendMessages('shared-id', [{ id: 'a-m1', role: 'user', content: [{ type: 'text', text: 'Tenant A confidential' }], createdAt: new Date().toISOString() }]);
    await a.startRun({ id: 'run-a', threadId: 'shared-id', subject: 'alice', startedAt: new Date().toISOString() });

    expect((await b.getThread('shared-id'))?.title).toBe('B thread');
    expect(JSON.stringify((await b.listMessages('shared-id')).items)).not.toContain('Tenant A confidential');
    expect(await b.getRun('run-a')).toBeNull();
    expect((await b.listRuns()).items).toHaveLength(0);
    expect((await a.listMessages('shared-id')).items).toHaveLength(1);

    // Deleting B's thread leaves A's data intact; paging is keyset-based.
    expect(await b.deleteThread('shared-id')).toBe(true);
    expect(await a.getThread('shared-id')).not.toBeNull();
    for (let index = 0; index < 5; index += 1) await a.upsertThread({ id: `t-${index}`, subject: 'alice' });
    const page1 = await a.listThreads({ limit: 3 });
    const page2 = await a.listThreads({ limit: 3, cursor: page1.nextCursor });
    expect(new Set([...page1.items, ...page2.items].map((thread) => thread.id)).size).toBe(6);
  });

  it('memory: cross-tenant and cross-user reads are impossible through the store', async () => {
    const memory = persistence.memory();
    const aliceOwner = { type: 'user' as const, id: 'alice' };
    const saved = await memory.put({ type: 'durable', owner: aliceOwner, tenantId: 'tenant-a', value: 'Prefers English' });
    await expect(memory.put({ type: 'durable', owner: aliceOwner, tenantId: 'tenant-a', value: 'api_key=sk-live-123456789012345678901234' })).rejects.toThrow();

    expect(await memory.get({ id: saved.id, owner: aliceOwner, tenantId: 'tenant-a' })).toMatchObject({ value: 'Prefers English' });
    await expect(memory.get({ id: saved.id, owner: aliceOwner, tenantId: 'tenant-b' })).rejects.toThrow();
    await expect(memory.get({ id: saved.id, owner: { type: 'user', id: 'mallory' }, tenantId: 'tenant-a' })).rejects.toThrow();
    expect(await memory.search({ owner: aliceOwner, tenantId: 'tenant-b' })).toEqual([]);
    expect(await memory.search({ owner: { type: 'user', id: 'mallory' }, tenantId: 'tenant-a' })).toEqual([]);
    // Another tenant cannot overwrite the record by reusing its id.
    await expect(memory.put({ id: saved.id, type: 'durable', owner: { type: 'user', id: 'bob' }, tenantId: 'tenant-b', value: 'hijack' })).rejects.toThrow();
    await memory.delete({ owner: aliceOwner, tenantId: 'tenant-b' });
    expect((await memory.search({ owner: aliceOwner, tenantId: 'tenant-a' })).map((result) => result.record.id)).toContain(saved.id);
  });

  it('knowledge: tenant filtering happens in retrieval, before anything reaches the model', async () => {
    const store = createPgVectorStore({ pool });
    const record = (id: string, tenantId: string, content: string): VectorRecord => ({
      id, chunkId: id, documentId: `doc-${id}`, sourceId: 'handbook', tenantId, content,
      embedding: vector(content), embeddingProvider: embeddings.provider, embeddingModel: embeddings.model,
    });
    await store.upsert([record('a1', 'tenant-a', 'refund policy for tenant a'), record('b1', 'tenant-b', 'refund policy for tenant b secret')]);
    const retriever = createRetriever({ vectorStore: store, embeddingProvider: embeddings });
    const forA = await retriever.retrieve({ text: 'refund policy', topK: 5 }, { securityContext: A });
    expect(forA.items.map(({ item }) => item.chunk.content)).toEqual(['refund policy for tenant a']);
    const forB = await retriever.retrieve({ text: 'refund policy', topK: 5 }, { securityContext: B });
    expect(forB.items.map(({ item }) => item.chunk.content)).toEqual(['refund policy for tenant b secret']);
  });

  it('workflows: Tenant A cannot resume, cancel or read Tenant B’s workflow run', async () => {
    const checkpointStore = createPgCheckpointStore({ pool });
    const engine = createWorkflowEngine({ checkpointStore, approvals: createInMemoryApprovalStore() });
    engine.register(
      defineWorkflow({
        id: 'refund',
        version: '1',
        input: z.object({ amount: z.number() }),
        state: z.object({ amount: z.number(), done: z.boolean() }),
        initialState: (input) => ({ amount: input.amount, done: false }),
        steps: [
          approvalStep<{ amount: number; done: boolean }>({ id: 'approve', action: 'payments.refund', summary: () => 'Refund', approval: 'supervisor' }),
          functionStep<{ amount: number; done: boolean }>({ id: 'pay', dependencies: ['approve'], run: ({ state }) => ({ ...state, done: true }) }),
        ],
      }),
    );
    const started = await engine.start({ workflowId: 'refund', input: { amount: 10 }, securityContext: B, tenantId: 'tenant-b' });
    expect(started.status).toBe('waiting_for_approval');
    await expect(engine.resume(started.workflowRunId, { securityContext: A })).rejects.toThrow(/different tenant/);
    await expect(engine.cancel(started.workflowRunId, A)).rejects.toThrow(/different tenant/);
    await expect(engine.getCheckpoint(started.workflowRunId, A)).rejects.toThrow(/different tenant/);
    expect((await engine.getCheckpoint(started.workflowRunId, B))?.status).toBe('waiting_for_approval');
  });

  it('audit: tenant-scoped search only, and rows are immutable except the retention purge', async () => {
    const audit = persistence.audit;
    const entry = (id: string, tenantId: string, subject: string): AuditRecord => ({
      id, tenantId, timestamp: new Date().toISOString(), actor: { kind: 'user', subject }, action: 'payments.refund', decision: 'deny', runId: `run-${id}`,
    });
    await audit.write(entry('audit-a1', 'tenant-a', 'alice'));
    await audit.write(entry('audit-a1', 'tenant-a', 'alice')); // idempotent
    await audit.write(entry('audit-b1', 'tenant-b', 'bob'));
    const aResults = await audit.forTenant({ tenantId: 'tenant-a' }).search({ action: 'payments.refund' });
    expect(aResults.items.map((record) => record.id)).toEqual(['audit-a1']);
    expect((await audit.forTenant({ tenantId: 'tenant-a' }).search({ actor: 'bob' })).items).toHaveLength(0);

    await expect(pool.query(`UPDATE audit_records SET decision = 'allow' WHERE id = 'audit-a1'`)).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM audit_records WHERE id = 'audit-a1'`)).rejects.toThrow(/append-only/);
    expect(await audit.purgeBefore({ tenantId: 'tenant-b' }, new Date(Date.now() + 1000))).toBe(1);
    expect((await audit.forTenant({ tenantId: 'tenant-a' }).search()).items).toHaveLength(1);
  });

  it('server end to end: runs are persisted per authenticated tenant; anonymous runs are refused', async () => {
    const identities: Record<string, Identity> = {
      alice: { subject: 'alice', roles: [], permissions: [], attributes: { tenantId: 'tenant-a' } },
      bob: { subject: 'bob', roles: [], permissions: [], attributes: { tenantId: 'tenant-b' } },
    };
    const copilot = createCopilot({
      model: { provider: 'mock', model: 'demo' },
      providers: [createMockProvider({ id: 'mock', scenario: { chunks: ['Stored', ' answer'] } })],
      security: { authentication: createStaticAuthenticationAdapter(identities) },
      server: { requireAuthentication: true, runObservers: [createConversationRecorder(persistence.conversations)] },
    });
    try {
      const run = await copilot.run({ threadId: 'thread-e2e', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello from A' }] }], headers: { authorization: 'Bearer alice' } });
      expect(run.status).toBe('completed');
      const a = persistence.conversations.forTenant({ tenantId: 'tenant-a' });
      expect((await a.listMessages('thread-e2e')).items.map((message) => message.role)).toEqual(['user', 'assistant']);
      const runs = await a.listRuns({ threadId: 'thread-e2e' });
      expect(runs.items[0]).toMatchObject({ status: 'completed', subject: 'alice' });
      expect(await persistence.conversations.forTenant({ tenantId: 'tenant-b' }).getThread('thread-e2e')).toBeNull();

      const anonymous = await copilot.app.inject({ method: 'POST', url: '/runs', payload: { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] } });
      expect(anonymous.statusCode).toBe(401);
    } finally {
      await copilot.close();
    }
  });

  it('usage: idempotent recording and SQL aggregation, scoped to one tenant', async () => {
    const usage = persistence.usage;
    const base = { inputTokens: 100, outputTokens: 50, totalTokens: 150, count: 1, occurredAt: '2026-09-27T10:00:00.000Z' };
    await usage.record([
      { ...base, id: 'r1:model', tenantId: 'tenant-a', projectId: 'visa', kind: 'model', provider: 'openai', model: 'gpt-4o-mini', estimatedCostMicros: 900 },
      { ...base, id: 'r1:model', tenantId: 'tenant-a', projectId: 'visa', kind: 'model', provider: 'openai', model: 'gpt-4o-mini', estimatedCostMicros: 900 },
      { ...base, id: 'r2:model', tenantId: 'tenant-a', projectId: 'visa', kind: 'model', provider: 'openai', model: 'gpt-4o', occurredAt: '2026-09-28T10:00:00.000Z' },
      { ...base, id: 'r3:model', tenantId: 'tenant-b', kind: 'model', provider: 'openai', model: 'gpt-4o-mini', estimatedCostMicros: 5000 },
    ]);
    const rows = await usage.forTenant({ tenantId: 'tenant-a' }).aggregate({ kinds: ['model'], groupBy: ['model', 'day'] });
    expect(rows.map((row) => [row.key.model, row.key.day, row.totalTokens, row.estimatedCostMicros, row.pricedEvents]).sort()).toEqual([
      ['gpt-4o', '2026-09-28', 150, 0, 0],
      ['gpt-4o-mini', '2026-09-27', 150, 900, 1],
    ]);
    const totals = await usage.forTenant({ tenantId: 'tenant-a' }).aggregate({ from: '2026-09-28T00:00:00.000Z' });
    expect(totals[0]?.totalTokens).toBe(150);
    const other = await usage.forTenant({ tenantId: 'tenant-b' }).aggregate();
    expect(other[0]?.estimatedCostMicros).toBe(5000);
    expect(await usage.forTenant({ tenantId: 'tenant-c' }).aggregate()).toEqual([]);
  });

  it('control plane: the management service on PostgreSQL keeps tenants apart and secrets encrypted', async () => {
    const secretsStore = createEncryptedSecretStore({ repository: persistence.secretRepository, keys: { v1: randomBytes(32).toString('base64') }, activeKeyVersion: 'v1' });
    const service = createManagementService({
      store: persistence.controlPlane,
      audit: createAuditMemory(),
      secrets: secretsStore,
      catalog: { tools: () => [{ name: 'payments.refund', description: 'Refund', approval: 'supervisor' }] },
    });
    const root = { subject: 'root', platformAdmin: true };
    await service.createTenant(root, { id: 'cp-a', name: 'A', owner: 'alice' });
    await service.createTenant(root, { id: 'cp-b', name: 'B', owner: 'bob' });
    const alice = { subject: 'alice', tenantId: 'cp-a', platformAdmin: false };
    const bob = { subject: 'bob', tenantId: 'cp-b', platformAdmin: false };
    const { project, environments: envs } = await service.createProject(alice, { name: 'Visa', slug: 'visa' });
    expect(envs.map((environment) => environment.name)).toEqual(['development', 'staging', 'production']);
    await expect(service.createProject(alice, { name: 'Dup', slug: 'visa' })).rejects.toThrow(/already exists/);
    expect(await service.listProjects(bob)).toEqual([]);
    await expect(service.listEnvironments(bob, project.id)).rejects.toThrow(/not found/);

    await service.putSecret(alice, 'openai-key', 'sk-test-pg-plaintext-must-not-appear-000000');
    const dump = await pool.query<{ all_rows: string | null }>(`SELECT string_agg(t::text, ' ') AS all_rows FROM (SELECT * FROM secrets) t`);
    expect(String(dump.rows[0]?.all_rows)).not.toContain('sk-test-pg-plaintext');
    expect(await secretsStore.reveal('cp-a', 'openai-key')).toBe('sk-test-pg-plaintext-must-not-appear-000000');
    expect(await secretsStore.reveal('cp-b', 'openai-key')).toBeUndefined();

    const { resource } = await service.createResource(alice, { kind: 'model', name: 'primary', spec: { provider: 'openai', model: 'gpt-4o-mini', apiKeySecret: 'openai-key' } });
    await service.updateResource(alice, resource.id, { provider: 'openai', model: 'gpt-4o', apiKeySecret: 'openai-key' });
    const detail = await service.getResource(alice, resource.id);
    expect(detail.versions.map((version) => version.version)).toEqual([1, 2]);
    expect(detail.resource.currentVersion).toBe(2);
    await expect(service.getResource(bob, resource.id)).rejects.toThrow(/not found/);
    await expect(service.createResource(alice, { kind: 'tool', name: 'refund', spec: { tool: 'payments.refund', approval: 'none' } })).rejects.toThrow(/cannot lower/);
    const snapshot = await service.snapshot({ tenantId: 'cp-a' });
    expect(snapshot.resources).toEqual([{ kind: 'model', name: 'primary', version: 2, spec: { provider: 'openai', model: 'gpt-4o', apiKeySecret: 'openai-key' } }]);
    expect((await service.snapshot({ tenantId: 'cp-b' })).resources).toEqual([]);
  });

  it('approvals: a decision on one instance releases the run waiting on another; model text never approves', async () => {
    const instanceA = createPostgresPersistence({ pool }).approvals;
    const instanceB = createPostgresPersistence({ pool }).approvals;
    const created = await instanceA.create({ approvalId: 'ap-1', actionId: 'refund-1', runId: 'run-1', requestedBy: 'alice', tenantId: 'tenant-a', approvalLevel: 'supervisor', summary: 'Refund 50' });
    expect(created.status).toBe('pending');
    const waiting = instanceA.awaitDecision('ap-1');
    const decided = await instanceB.approve('ap-1', 'sam');
    expect(decided.status).toBe('approved');
    expect((await waiting).status).toBe('approved');
    // A stale revision is refused (two approvers racing).
    await instanceA.create({ approvalId: 'ap-2', actionId: 'refund-2', runId: 'run-2', requestedBy: 'alice', tenantId: 'tenant-a', approvalLevel: 'two-person', summary: 'Refund 5000' });
    await instanceA.approve('ap-2', 'sam', undefined, new Date(), 0);
    await expect(instanceB.approve('ap-2', 'pat', undefined, new Date(), 0)).rejects.toThrow('Approval revision changed.');
    // Expiry is enforced on read.
    await instanceA.create({ approvalId: 'ap-3', actionId: 'refund-3', runId: 'run-3', tenantId: 'tenant-a', approvalLevel: 'supervisor', summary: 'x', expiresInMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await instanceB.get('ap-3'))?.status).toBe('expired');
    await expect(instanceA.create({ approvalId: 'ap-1', actionId: 'other', runId: 'run-9', tenantId: 'tenant-a', approvalLevel: 'none', summary: 'hijack' })).rejects.toThrow(/another action/);
  });
});
