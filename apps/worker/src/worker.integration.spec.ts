import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '@gixcopilot/config';
import { createKnowledgeDocument } from '@gixcopilot/knowledge';
import type { DocumentLoader, WebSourceConfig } from '@gixcopilot/knowledge';
import { createInMemoryAuditSink } from '@gixcopilot/security';
import { createManagementService } from '@gixcopilot/management';
import { createPostgresPersistence } from '@gixcopilot/persistence-postgres';
import type { PostgresPersistence } from '@gixcopilot/persistence-postgres';
import { createRetriever } from '@gixcopilot/rag';
import type { EmbeddingProvider } from '@gixcopilot/rag';
import { createPgVectorStore } from '@gixcopilot/vectorstore-pgvector';
import { createWorker } from './worker.js';
import type { WorkerProcess } from './worker.js';

function dockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Deterministic 1536-dim test embeddings (a labelled test double, no network). */
const embeddings: EmbeddingProvider = {
  provider: 'test',
  model: 'hash-1536',
  dimensions: 1536,
  embedDocuments: (texts) => Promise.resolve(texts.map(vector)),
  embedQuery: (text) => Promise.resolve(vector(text)),
};
// Explicitly trusted fixture loader: the production default correctly refuses loopback URLs.
const fixtureLoader: DocumentLoader<WebSourceConfig> = {
  async *load(source, context) {
    const response = await fetch(source.config.url, { signal: context?.signal });
    if (!response.ok) throw new Error(`Fixture returned ${response.status}`);
    yield createKnowledgeDocument({
      sourceId: source.id,
      content: await response.text(),
      metadata: { uri: source.config.url, tenantId: source.tenantId, acl: source.acl },
    });
  },
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

async function until(predicate: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe.skipIf(!dockerAvailable())('apps/worker on real PostgreSQL + Redis', () => {
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let persistence: PostgresPersistence;
  let workers: WorkerProcess[] = [];
  let site: ReturnType<typeof createServer>;
  let siteUrl = '';

  beforeAll(async () => {
    [postgres, redis] = await Promise.all([new PostgreSqlContainer('pgvector/pgvector:pg16').start(), new RedisContainer('redis:7-alpine').start()]);
    persistence = createPostgresPersistence({ connectionString: postgres.getConnectionUri() });
    await persistence.migrator.up();
    site = createServer((_request, response) => {
      response.setHeader('content-type', 'text/plain');
      response.end('Refund policy: refunds are processed within 14 days for tenant acme.');
    });
    await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
    siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}/policy.txt`;
    const config = await loadConfig({
      env: { NODE_ENV: 'test', DATABASE_URL: postgres.getConnectionUri(), REDIS_URL: `redis://${redis.getHost()}:${redis.getPort()}`, AICOPILOT_RETENTION_CONVERSATION_DAYS: '30' },
    });
    // Two worker processes compete for the same queue (Section 150).
    workers = [createWorker({ config, persistence, embeddingProvider: embeddings, knowledgeLoader: fixtureLoader }), createWorker({ config, persistence, embeddingProvider: embeddings, knowledgeLoader: fixtureLoader })];
    await Promise.all(workers.map((worker) => worker.worker.ready));
  }, 180_000);

  afterAll(async () => {
    await Promise.all(workers.map((worker) => worker.shutdown()));
    await persistence?.close();
    site?.close();
    await Promise.all([postgres?.stop(), redis?.stop()]);
  });

  it('ingests a knowledge source for its tenant only, via an idempotent job', async () => {
    const service = createManagementService({ store: persistence.controlPlane, audit: createInMemoryAuditSink() });
    await service.createTenant({ subject: 'root', platformAdmin: true }, { id: 'acme', name: 'Acme', owner: 'alice' });
    const alice = { subject: 'alice', tenantId: 'acme', platformAdmin: false };
    const { resource } = await service.createResource(alice, { kind: 'knowledge-source', name: 'policy', spec: { sourceId: 'policy', type: 'url', uri: siteUrl } });
    const queue = workers[0]?.queue;
    if (!queue) throw new Error('no queue');
    const first = await queue.enqueue('knowledge.index', { tenantId: 'acme', resourceId: resource.id, version: 1 }, { idempotencyKey: `acme:${resource.id}:1`, tenantId: 'acme' });
    const again = await queue.enqueue('knowledge.index', { tenantId: 'acme', resourceId: resource.id, version: 1 }, { idempotencyKey: `acme:${resource.id}:1`, tenantId: 'acme' });
    expect(again).toEqual({ jobId: first.jobId, duplicate: true });
    await until(async () => (await queue.status(first.jobId)) === 'completed');

    const retriever = createRetriever({ vectorStore: createPgVectorStore({ pool: persistence.pool }), embeddingProvider: embeddings });
    const acme = await retriever.retrieve({ text: 'refund policy days' }, { securityContext: { tenant: { tenantId: 'acme' }, identity: { subject: 'alice', roles: [], permissions: [] } } });
    expect(acme.items.map(({ item }) => item.chunk.content).join(' ')).toContain('14 days');
    const other = await retriever.retrieve({ text: 'refund policy days' }, { securityContext: { tenant: { tenantId: 'globex' }, identity: { subject: 'gary', roles: [], permissions: [] } } });
    expect(other.items).toHaveLength(0);
    const usage = await persistence.usage.forTenant({ tenantId: 'acme' }).aggregate({ kinds: ['embedding'] });
    expect(usage[0]?.count).toBeGreaterThan(0);
  });

  it('dead-letters a job for another tenant’s resource instead of retrying forever', async () => {
    const queue = workers[0]?.queue;
    if (!queue) throw new Error('no queue');
    const { jobId } = await queue.enqueue('knowledge.index', { tenantId: 'globex', resourceId: 'does-not-exist', version: 1 }, { idempotencyKey: 'globex:missing:1', attempts: 5 });
    await until(async () => (await queue.status(jobId)) === 'failed');
  });

  it('runs retention maintenance once per day across workers', async () => {
    const scoped = persistence.conversations.forTenant({ tenantId: 'acme' });
    await scoped.upsertThread({ id: 'old-thread' });
    await persistence.pool.query(`UPDATE threads SET updated_at = now() - interval '90 days' WHERE id = 'old-thread'`);
    await scoped.upsertThread({ id: 'recent-thread' });
    await Promise.all(workers.map((worker) => worker.scheduleMaintenance()));
    const queue = workers[0]?.queue;
    const day = new Date().toISOString().slice(0, 10);
    await until(async () => (await queue?.status(`maintenance.retention__${day}`)) === 'completed');
    expect(await scoped.getThread('old-thread')).toBeNull();
    expect(await scoped.getThread('recent-thread')).not.toBeNull();
  });
});
