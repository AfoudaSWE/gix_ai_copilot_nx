import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createDevTools } from '@gixcopilot/devtools';
import { createInMemoryEvalStore } from '@gixcopilot/evals';
import type { EvalRun } from '@gixcopilot/evals';
import { createInMemoryAuditSink, createStaticAuthenticationAdapter } from '@gixcopilot/security';
import type { AuditRecord, Identity } from '@gixcopilot/security';
import { createRecordingTelemetry, recordRun } from '@gixcopilot/telemetry';
import { createInMemoryConversationStore } from '@gixcopilot/tenancy';
import { createInMemoryUsageStore } from '@gixcopilot/usage';
import {
  createEncryptedSecretStore,
  createInMemoryControlPlaneStore,
  createInMemorySecretRepository,
  createManagementPlugin,
  createManagementService,
  createSnapshotCache,
} from './index.js';

const who = (subject: string, tenantId?: string, permissions: string[] = []): Identity => ({ subject, roles: [], permissions, ...(tenantId ? { attributes: { tenantId } } : {}) });
const identities: Record<string, Identity> = {
  owner: who('owner', 'acme'),
  admin: who('admin', 'acme'),
  operator: who('operator', 'acme'),
  viewer: who('viewer', 'acme'),
  rival: who('rival', 'globex'),
  root: who('root', undefined, ['platform.admin']),
  stranger: who('stranger', 'acme'),
};

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function setup() {
  const store = createInMemoryControlPlaneStore();
  const audit = createInMemoryAuditSink();
  const secretRepository = createInMemorySecretRepository();
  const secrets = createEncryptedSecretStore({ repository: secretRepository, keys: { v1: randomBytes(32).toString('base64') }, activeKeyVersion: 'v1' });
  const conversations = createInMemoryConversationStore();
  const usage = createInMemoryUsageStore();
  const evalStores = new Map<string, ReturnType<typeof createInMemoryEvalStore>>();
  const recording = createRecordingTelemetry({ mode: 'redacted' });
  const jobs: { kind: string; key: string }[] = [];
  const service = createManagementService({
    store,
    audit,
    auditReader: {
      forTenant: (scope) => ({
        search: () => Promise.resolve({ items: audit.list().filter((record) => record.tenantId === scope.tenantId) }),
      }),
    },
    secrets,
    conversations,
    usage,
    evals: (tenantId) => {
      const existing = evalStores.get(tenantId) ?? createInMemoryEvalStore();
      evalStores.set(tenantId, existing);
      return existing;
    },
    traces: createDevTools({ source: recording }),
    jobs: {
      enqueue: (kind, _payload, options) => {
        const duplicate = jobs.some((job) => job.kind === kind && job.key === options.idempotencyKey);
        if (!duplicate) jobs.push({ kind, key: options.idempotencyKey });
        return Promise.resolve({ jobId: `${kind}__${options.idempotencyKey}`, duplicate });
      },
      status: () => Promise.resolve('queued'),
    },
    catalog: {
      agents: () => [{ id: 'support', version: '1', tools: ['applications.get', 'payments.refund'] }],
      tools: () => [
        { name: 'applications.get', description: 'Get', risk: 'read-only', approval: 'none' },
        { name: 'payments.refund', description: 'Refund', risk: 'write', approval: 'supervisor' },
      ],
    },
  });
  // Tenant bootstrap: the platform admin creates tenants with their first owner.
  const root = { subject: 'root', platformAdmin: true };
  await service.createTenant(root, { id: 'acme', name: 'Acme', owner: 'owner' });
  await service.createTenant(root, { id: 'globex', name: 'Globex', owner: 'rival' });
  const owner = { subject: 'owner', tenantId: 'acme', platformAdmin: false };
  for (const [subject, role] of [['admin', 'admin'], ['operator', 'operator'], ['viewer', 'viewer']] as const) await service.upsertMembership(owner, { subject, role });

  const app = Fastify();
  apps.push(app);
  await app.register(createManagementPlugin(service, { authentication: createStaticAuthenticationAdapter(identities) }), { prefix: '/management/v1' });
  const call = async (as: string | undefined, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
    const response = await app.inject({ method, url: `/management/v1${url}`, headers: as ? { authorization: `Bearer ${as}` } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { status: response.statusCode, body: response.json<Record<string, unknown> & { error?: { code: string } }>(), raw: response.body };
  };
  return { service, call, audit, secrets, secretRepository, conversations, usage, evalStores, recording, jobs };
}

describe('@gixcopilot/management API', () => {
  it('authenticates every route and enforces tenant roles', async () => {
    const { call } = await setup();
    expect((await call(undefined, 'GET', '/projects')).status).toBe(401);
    expect((await call('stranger', 'GET', '/projects')).status).toBe(403); // authenticated, no membership
    expect((await call('viewer', 'POST', '/projects', { name: 'Visa', slug: 'visa' })).status).toBe(403);
    const created = await call('admin', 'POST', '/projects', { name: 'Visa Platform', slug: 'visa' });
    expect(created.status).toBe(201);
    expect((created.body['environments'] as { name: string }[]).map((environment) => environment.name)).toEqual(['development', 'staging', 'production']);
    expect(((await call('viewer', 'GET', '/projects')).body as unknown as unknown[]).length).toBe(1);
    expect((await call('viewer', 'GET', '/me')).body).toMatchObject({ tenantId: 'acme', role: 'viewer' });
    // Invalid input is a 400/422, not a crash.
    expect((await call('admin', 'POST', '/projects', { name: 'x', slug: 'Not A Slug' })).status).toBe(422);
    expect((await call('admin', 'POST', '/projects', { nope: true })).status).toBe(400);
  });

  it('Tenant A cannot see or change Tenant B control-plane data; platform admins get no tenant data', async () => {
    const { call } = await setup();
    const project = await call('admin', 'POST', '/projects', { name: 'Visa', slug: 'visa' });
    const projectId = (project.body['project'] as { id: string }).id;
    expect(((await call('rival', 'GET', '/projects')).body as unknown as unknown[]).length).toBe(0);
    expect((await call('rival', 'POST', `/projects/${projectId}/archive`)).status).toBe(404); // not visible in globex, existence not revealed
    expect((await call('rival', 'GET', `/projects/${projectId}/environments`)).status).toBe(404);
    expect((await call('root', 'GET', '/tenants')).status).toBe(200);
    expect((await call('root', 'GET', '/projects')).status).toBe(401); // no tenant in the root identity
    expect((await call('owner', 'GET', '/tenants')).status).toBe(403);
  });

  it('secrets are write-only and encrypted at rest, bound to their tenant and name', async () => {
    const { call, secrets, secretRepository } = await setup();
    const value = 'sk-test-management-secret-000000000000';
    expect((await call('operator', 'PUT', '/secrets/openai-key', { value })).status).toBe(403);
    const put = await call('admin', 'PUT', '/secrets/openai-key', { value });
    expect(put.body).toEqual({ name: 'openai-key', configured: true });
    const listed = await call('admin', 'GET', '/secrets');
    expect(listed.raw).not.toContain(value);
    const row = await secretRepository.get('acme', 'openai-key');
    expect(JSON.stringify(row)).not.toContain(value);
    expect(await secrets.reveal('acme', 'openai-key')).toBe(value);
    // A ciphertext moved to another tenant does not decrypt.
    if (row) await secretRepository.save({ ...row, tenantId: 'globex' });
    await expect(secrets.reveal('globex', 'openai-key')).rejects.toThrow();

    // Models reference secrets by name; a missing secret is rejected.
    expect((await call('admin', 'POST', '/resources', { kind: 'model', name: 'primary', spec: { provider: 'openai', model: 'gpt-4o-mini', apiKeySecret: 'missing' } })).status).toBe(422);
    const model = await call('admin', 'POST', '/resources', { kind: 'model', name: 'primary', spec: { provider: 'openai', model: 'gpt-4o-mini', apiKeySecret: 'openai-key' } });
    expect(model.status).toBe(201);
    expect(model.raw).not.toContain(value);
  });

  it('the platform cannot weaken security declared in code or add dynamic agents/tools', async () => {
    const { call } = await setup();
    const weaker = await call('admin', 'POST', '/resources', { kind: 'tool', name: 'payments.refund', spec: { tool: 'payments.refund', approval: 'none' } });
    expect(weaker).toMatchObject({ status: 422, body: { error: { code: 'SECURITY_WEAKENING' } } });
    expect((await call('admin', 'POST', '/resources', { kind: 'tool', name: 'payments.refund', spec: { tool: 'payments.refund', approval: 'two-person' } })).status).toBe(201);
    expect((await call('admin', 'POST', '/resources', { kind: 'tool', name: 'x', spec: { tool: 'shell.exec' } })).body).toMatchObject({ error: { code: 'UNKNOWN_TOOL' } });
    expect((await call('admin', 'POST', '/resources', { kind: 'agent', name: 'support', spec: { agentId: 'support', tools: ['applications.get', 'admin.deleteAll'] } })).body).toMatchObject({ error: { code: 'SECURITY_WEAKENING' } });
    expect((await call('admin', 'POST', '/resources', { kind: 'agent', name: 'support', spec: { agentId: 'support', tools: ['applications.get'] } })).status).toBe(201);
    expect((await call('admin', 'POST', '/resources', { kind: 'agent', name: 'ghost', spec: { agentId: 'ghost' } })).body).toMatchObject({ error: { code: 'UNKNOWN_AGENT' } });
    const tools = await call('viewer', 'GET', '/tools');
    expect(tools.raw).toContain('two-person');
  });

  it('OpenAPI imports expose nothing by default; a refresh keeps prior decisions', async () => {
    const { call } = await setup();
    const document = {
      openapi: '3.1.0',
      info: { title: 'Visa', version: '1' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/applications/{id}': { get: { operationId: 'getApplication', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } } },
        '/applications/{id}/approve': { post: { operationId: 'approveApplication', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } } },
      },
    };
    const imported = await call('admin', 'POST', '/openapi/import', { integrationId: 'visa-api', document });
    expect(imported.status).toBe(201);
    const operations = (imported.body['version'] as { spec: { operations: { toolName: string; enabled: boolean }[] } }).spec.operations;
    expect(operations.length).toBeGreaterThan(0);
    expect(operations.every((operation) => !operation.enabled)).toBe(true);
    const resourceId = (imported.body['resource'] as { id: string }).id;
    const enabledFirst = { ...(imported.body['version'] as { spec: object }).spec, operations: operations.map((operation, index) => ({ ...operation, enabled: index === 0 })) };
    expect((await call('admin', 'POST', `/resources/${resourceId}/versions`, { spec: enabledFirst })).status).toBe(201);
    const refreshed = await call('admin', 'POST', '/openapi/import', { integrationId: 'visa-api', document });
    const after = (refreshed.body['version'] as { spec: { operations: { enabled: boolean }[] } }).spec.operations;
    expect(after.map((operation) => operation.enabled)).toEqual(operations.map((_, index) => index === 0));
    expect((await call('viewer', 'POST', '/openapi/import', { integrationId: 'visa-api', document })).status).toBe(403);
  });

  it('prompts are versioned and promoted draft -> staging -> production, never skipping staging', async () => {
    const { call } = await setup();
    const created = await call('admin', 'POST', '/resources', { kind: 'prompt', name: 'support-system', spec: { template: 'You are helpful. v1' } });
    const id = (created.body['resource'] as { id: string }).id;
    await call('admin', 'POST', `/resources/${id}/versions`, { spec: { template: 'You are helpful. v2' } });
    expect((await call('admin', 'POST', `/resources/${id}/versions/2/promote`, { stage: 'production' })).body).toMatchObject({ error: { code: 'INVALID_TRANSITION' } });
    expect((await call('admin', 'POST', `/resources/${id}/versions/2/promote`, { stage: 'staging' })).status).toBe(200);
    expect((await call('admin', 'POST', `/resources/${id}/versions/2/promote`, { stage: 'production' })).body).toMatchObject({ stage: 'production' });
    const detail = await call('viewer', 'GET', `/resources/${id}`);
    expect((detail.body['versions'] as { version: number; stage: string }[]).map((version) => version.stage)).toEqual(['draft', 'production']);
    expect((await call('admin', 'POST', `/resources/${id}/rollback`, { version: 1 })).body).toMatchObject({ currentVersion: 1 });
  });

  it('conversation metadata is operator-visible; content only when the tenant policy allows it', async () => {
    const { call, conversations, audit } = await setup();
    const scoped = conversations.forTenant({ tenantId: 'acme' });
    await scoped.upsertThread({ id: 't1', subject: 'customer-1' });
    await scoped.appendMessages('t1', [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'My passport number is X123' }], createdAt: new Date().toISOString() }]);
    expect((await call('viewer', 'GET', '/conversations')).status).toBe(403);
    expect(((await call('operator', 'GET', '/conversations')).body['items'] as unknown[]).length).toBe(1);
    const denied = await call('operator', 'GET', '/conversations/t1/messages');
    expect(denied.status).toBe(403);
    expect(denied.raw).not.toContain('X123');
    expect(audit.list().some((record: AuditRecord) => record.action === 'management.conversation.content' && record.decision === 'denied')).toBe(true);
    await call('admin', 'POST', '/resources', { kind: 'security-policy', name: 'default', spec: { conversationContentAccess: 'operators' } });
    expect((await call('operator', 'GET', '/conversations/t1/messages')).raw).toContain('X123');
    expect(((await call('rival', 'GET', '/conversations')).body['items'] as unknown[]).length).toBe(0);
  });

  it('traces, audit, usage and evals are tenant-scoped views over existing Phase 11/12 data', async () => {
    const { call, recording, usage, evalStores } = await setup();
    recordRun(recording, { kind: 'copilot', phase: 'started', correlation: { runId: 'run-acme', tenantId: 'acme' } });
    recordRun(recording, { kind: 'copilot', phase: 'completed', correlation: { runId: 'run-acme', tenantId: 'acme' }, latencyMs: 12 });
    recordRun(recording, { kind: 'copilot', phase: 'started', correlation: { runId: 'run-globex', tenantId: 'globex' } });
    const traces = await call('operator', 'GET', '/traces');
    expect((traces.body as unknown as { runId: string }[]).map((trace) => trace.runId)).toEqual(['run-acme']);
    expect((await call('operator', 'GET', '/traces/run-globex')).status).toBe(404);
    expect((await call('viewer', 'GET', '/traces')).status).toBe(403);

    const auditView = await call('operator', 'GET', '/audit');
    const records = auditView.body['items'] as AuditRecord[];
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((record) => record.tenantId === 'acme')).toBe(true);

    await usage.record([
      { id: 'u1', tenantId: 'acme', kind: 'model', model: 'gpt-4o-mini', inputTokens: 10, outputTokens: 5, totalTokens: 15, count: 1, estimatedCostMicros: 42, occurredAt: new Date().toISOString() },
      { id: 'u2', tenantId: 'globex', kind: 'model', model: 'gpt-4o', inputTokens: 999, outputTokens: 1, totalTokens: 1000, count: 1, occurredAt: new Date().toISOString() },
    ]);
    const usageView = await call('viewer', 'GET', '/usage?groupBy=model');
    expect(usageView.body['costLabel']).toMatch(/Estimated/);
    expect((usageView.body['rows'] as { key: { model: string }; totalTokens: number }[]).map((row) => [row.key.model, row.totalTokens])).toEqual([['gpt-4o-mini', 15]]);
    expect((await call('viewer', 'GET', '/usage?groupBy=password')).status).toBe(400);

    const run = (id: string, passed: number): EvalRun => ({ id, dataset: { id: 'support', version: '1' }, startedAt: new Date().toISOString(), summary: { cases: 2, passed } }) as unknown as EvalRun;
    await call('viewer', 'GET', '/evals'); // creates the tenant's store
    await evalStores.get('acme')?.save(run('eval-1', 2));
    expect(((await call('viewer', 'GET', '/evals')).body as unknown as { id: string }[]).map((entry) => entry.id)).toEqual(['eval-1']);
    expect(((await call('rival', 'GET', '/evals')).body as unknown as unknown[]).length).toBe(0);
  });

  it('knowledge reindex and eval start go through idempotent jobs; mutations are audited', async () => {
    const { call, jobs, audit } = await setup();
    const source = await call('admin', 'POST', '/resources', { kind: 'knowledge-source', name: 'handbook', spec: { sourceId: 'handbook', type: 'url', uri: 'https://example.com/handbook' } });
    const id = (source.body['resource'] as { id: string }).id;
    expect((await call('viewer', 'POST', `/knowledge/${id}/reindex`)).status).toBe(403);
    expect((await call('operator', 'POST', `/knowledge/${id}/reindex`)).status).toBe(202);
    expect((await call('operator', 'POST', `/knowledge/${id}/reindex`)).body).toMatchObject({ duplicate: true });
    expect(jobs).toHaveLength(1);
    expect((await call('operator', 'POST', '/evals', { datasetId: 'support', requestId: 'r1' })).status).toBe(202);
    const actions = audit.list().map((record) => record.action);
    expect(actions).toEqual(expect.arrayContaining(['management.tenant.create', 'management.membership.upsert', 'management.knowledge-source.create', 'management.knowledge.reindex', 'management.eval.start']));
  });

  it('keeps one owner, and resolves config snapshots that only change when config changes', async () => {
    const { call, service } = await setup();
    expect((await call('owner', 'DELETE', '/memberships/owner')).body).toMatchObject({ error: { code: 'LAST_OWNER' } });
    const created = await call('admin', 'POST', '/resources', { kind: 'rate-limit', name: 'per-user', spec: { scope: 'user', limit: 60, windowMs: 60_000 } });
    const id = (created.body['resource'] as { id: string }).id;
    const first = await service.snapshot({ tenantId: 'acme' });
    expect(first.resources).toEqual([{ kind: 'rate-limit', name: 'per-user', version: 1, spec: { scope: 'user', limit: 60, windowMs: 60_000 } }]);
    expect((await service.snapshot({ tenantId: 'acme' })).id).toBe(first.id);
    await call('admin', 'POST', `/resources/${id}/versions`, { spec: { scope: 'user', limit: 30, windowMs: 60_000 } });
    const second = await service.snapshot({ tenantId: 'acme' });
    expect(second.id).not.toBe(first.id);
    await call('admin', 'POST', `/resources/${id}/enabled`, { enabled: false });
    expect((await service.snapshot({ tenantId: 'acme' })).resources).toEqual([]);
    expect((await service.snapshot({ tenantId: 'globex' })).resources).toEqual([]);

    // Control plane unavailable: the data plane keeps the last good snapshot.
    let fail = false;
    let time = 0;
    const cache = createSnapshotCache({ load: (scope) => (fail ? Promise.reject(new Error('down')) : service.snapshot(scope)), ttlMs: 10, now: () => time });
    const good = await cache.get({ tenantId: 'acme' });
    fail = true;
    time = 100;
    expect(await cache.get({ tenantId: 'acme' })).toEqual({ snapshot: good.snapshot, stale: true });
    await expect(cache.get({ tenantId: 'globex' })).rejects.toThrow('down');
  });
});
