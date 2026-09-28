import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { VectorRecord } from '@gixcopilot/rag';
import { createPgVectorStore } from './pg-vector-store.js';

/**
 * Real-database integration tests (Section 152) - per the testing skill, a genuine new DB
 * dependency (pgvector, this package's first) is verified against Testcontainers, not mocked.
 * Auto-skips when Docker is unreachable rather than failing the whole suite - confirmed
 * unreachable in the sandbox this was authored in (`docker info` fails), so these tests were
 * written and typechecked but NOT executed against a live Postgres in that session; run them
 * wherever Docker is available (`pnpm --filter @gixcopilot/vectorstore-pgvector test`).
 */
function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    // CI sets REQUIRE_DOCKER=1 so these suites fail loudly instead of silently skipping.
    if (process.env['REQUIRE_DOCKER'] === '1') {
      throw new Error('REQUIRE_DOCKER=1 but Docker is unreachable (docker info failed).');
    }
    return false;
  }
}

const dockerAvailable = isDockerAvailable();

async function runMigration(pool: Pool): Promise<void> {
  const migrationPath = fileURLToPath(new URL('../migrations/0000_init.sql', import.meta.url));
  const sql = await readFile(migrationPath, 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) await pool.query(trimmed);
  }
}

function embedding(seed: number): number[] {
  const vector = new Array<number>(1536).fill(0);
  vector[0] = seed;
  vector[1] = 1 - seed;
  return vector;
}

function record(overrides: Partial<VectorRecord> & Pick<VectorRecord, 'id'>): VectorRecord {
  return {
    chunkId: overrides.id,
    documentId: 'doc-1',
    sourceId: 'source-1',
    tenantId: 'tenant-a',
    content: 'content',
    embedding: embedding(1),
    embeddingProvider: 'test',
    embeddingModel: 'test',
    ...overrides,
  };
}

describe.skipIf(!dockerAvailable)('createPgVectorStore (Testcontainers integration)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    await runMigration(pool);
  }, 180_000);

  beforeEach(async () => { await pool.query('TRUNCATE knowledge_chunks, memory_embeddings'); });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('enforces SQL ACL filtering before LIMIT and rejects malformed/unknown ACLs', async () => {
    const store = createPgVectorStore({ pool });
    await store.upsert([
      record({ id: 'restricted', acl: { permissions: ['admin.read'] } }),
      record({ id: 'public', embedding: embedding(0.9) }),
      record({ id: 'role', acl: { roles: ['viewer'] } }),
      record({ id: 'malformed', acl: JSON.parse('{"roles":"viewer"}') as VectorRecord['acl'] }),
      record({ id: 'unknown', acl: JSON.parse('{"allowedRoles":["viewer"]}') as VectorRecord['acl'] }),
    ]);
    const anonymous = await store.search({ embedding: embedding(1), tenantId: 'tenant-a', topK: 1, access: {} });
    expect(anonymous.map((result) => result.record.id)).toEqual(['public']);
    const viewer = await store.search({ embedding: embedding(1), tenantId: 'tenant-a', topK: 10, access: { roles: ['viewer'] } });
    expect(viewer.map((result) => result.record.id).sort()).toEqual(['public', 'role']);
  });

  it('isolates colliding keys and tenant-scoped deletes, including empty chunk filters', async () => {
    const store = createPgVectorStore({ pool });
    await store.upsert([record({ id: 'same', tenantId: 'a' }), record({ id: 'same', tenantId: 'b' })]);
    await store.delete({ tenantId: 'a', sourceId: 'source-1', chunkIds: [] });
    expect(await store.list?.({ tenantId: 'a', limit: 10 })).toHaveLength(1);
    await store.delete({ tenantId: 'a', documentId: 'doc-1' });
    expect(await store.list?.({ tenantId: 'a', limit: 10 })).toHaveLength(0);
    expect(await store.list?.({ tenantId: 'b', limit: 10 })).toHaveLength(1);
  });

  it('rolls replacement back on insertion failure and serializes concurrent replacements', async () => {
    const store = createPgVectorStore({ pool });
    const original = record({ id: 'original', content: 'old' });
    const filter = { tenantId: 'tenant-a', sourceId: 'source-1', documentId: 'doc-1' };
    await store.upsert([original]);
    // Duplicated primary keys force a genuine SQL error after the transaction deletes old rows.
    await expect(store.replace?.(filter, [record({ id: 'duplicate' }), record({ id: 'duplicate' })])).rejects.toThrow();
    expect((await store.list?.({ tenantId: 'tenant-a', limit: 10 }))?.[0]?.content).toBe('old');
    await Promise.all([store.replace?.(filter, [record({ id: 'v1' })]), store.replace?.(filter, [record({ id: 'v2' })])]);
    expect(await store.list?.({ tenantId: 'tenant-a', limit: 10 })).toHaveLength(1);
  });

  it('applies threshold, embedding model and typed metadata constraints', async () => {
    const store = createPgVectorStore({ pool });
    await store.upsert([
      record({ id: 'current', metadata: { revision: 1 } }),
      record({ id: 'old-model', embeddingModel: 'old', metadata: { revision: 1 } }),
      record({ id: 'wrong-type', metadata: { revision: '1' } }),
      record({ id: 'orthogonal', embedding: embedding(0), metadata: { revision: 1 } }),
    ]);
    const hits = await store.search({ embedding: embedding(1), tenantId: 'tenant-a', topK: 10,
      threshold: 0.5, embeddingModel: 'test', filters: { metadata: { revision: 1 } } });
    expect(hits.map((hit) => hit.record.id)).toEqual(['current']);
  });

  it('inserts and searches a real record end to end', async () => {
    const store = createPgVectorStore({ pool });
    await store.upsert([record({ id: 'r1', embedding: embedding(1) })]);
    const results = await store.search({ embedding: embedding(1), tenantId: 'tenant-a', topK: 5 });
    expect(results).toHaveLength(1);
    expect(results[0]?.record.id).toBe('r1');
    expect(results[0]?.score).toBeCloseTo(1, 3);
  });

  it('upsert (ON CONFLICT) updates an existing row rather than duplicating it', async () => {
    const store = createPgVectorStore({ pool });
    await store.upsert([record({ id: 'r2', content: 'v1', embedding: embedding(0.9) })]);
    await store.upsert([record({ id: 'r2', content: 'v2', embedding: embedding(0.9) })]);
    const results = await store.search({ embedding: embedding(0.9), tenantId: 'tenant-a', topK: 10 });
    const matches = results.filter((r) => r.record.id === 'r2');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.record.content).toBe('v2');
  });

  it('scopes search by tenant at the SQL level (Section 154)', async () => {
    const store = createPgVectorStore({ pool });
    await store.upsert([
      record({ id: 'tenant-a-doc', tenantId: 'tenant-a', embedding: embedding(0.5) }),
      record({ id: 'tenant-b-doc', tenantId: 'tenant-b', embedding: embedding(0.5) }),
    ]);
    const forA = await store.search({ embedding: embedding(0.5), tenantId: 'tenant-a', topK: 10 });
    const forB = await store.search({ embedding: embedding(0.5), tenantId: 'tenant-b', topK: 10 });
    expect(forA.some((r) => r.record.id === 'tenant-b-doc')).toBe(false);
    expect(forB.some((r) => r.record.id === 'tenant-a-doc')).toBe(false);
  });

  it('applies metadata and tag filters', async () => {
    const store = createPgVectorStore({ pool });
    await store.upsert([
      record({ id: 'hr-doc', sourceId: 'src-hr', embedding: embedding(0.3), metadata: { tags: ['hr'], region: 'ae' } }),
      record({ id: 'fin-doc', sourceId: 'src-fin', embedding: embedding(0.3), metadata: { tags: ['finance'], region: 'us' } }),
    ]);
    const bySource = await store.search({ embedding: embedding(0.3), tenantId: 'tenant-a', topK: 10, filters: { sourceId: 'src-hr' } });
    expect(bySource.map((r) => r.record.id)).toContain('hr-doc');
    expect(bySource.map((r) => r.record.id)).not.toContain('fin-doc');

    const byTag = await store.search({ embedding: embedding(0.3), tenantId: 'tenant-a', topK: 10, filters: { tags: ['finance'] } });
    expect(byTag.map((r) => r.record.id)).toContain('fin-doc');
    expect(byTag.map((r) => r.record.id)).not.toContain('hr-doc');

    const byMetadata = await store.search({
      embedding: embedding(0.3),
      tenantId: 'tenant-a',
      topK: 10,
      filters: { metadata: { region: 'ae' } },
    });
    expect(byMetadata.map((r) => r.record.id)).toContain('hr-doc');
    expect(byMetadata.map((r) => r.record.id)).not.toContain('fin-doc');
  });

  it('persists and returns ACL metadata unchanged', async () => {
    const store = createPgVectorStore({ pool });
    await store.upsert([record({ id: 'acl-doc', embedding: embedding(0.7), acl: { roles: ['admin'], permissions: ['knowledge.admin.read'] } })]);
    const [result] = await store.search({ embedding: embedding(0.7), tenantId: 'tenant-a', topK: 5 });
    expect(result?.record.acl).toEqual({ roles: ['admin'], permissions: ['knowledge.admin.read'] });
  });

  it('deletes by documentId and by sourceId', async () => {
    const store = createPgVectorStore({ pool });
    await store.upsert([
      record({ id: 'del-a', documentId: 'doc-del-1', sourceId: 'src-del', embedding: embedding(0.2) }),
      record({ id: 'del-b', documentId: 'doc-del-2', sourceId: 'src-del', embedding: embedding(0.2) }),
    ]);
    await store.delete({ tenantId: 'tenant-a', documentId: 'doc-del-1' });
    let remaining = await store.search({ embedding: embedding(0.2), tenantId: 'tenant-a', topK: 10, filters: { sourceId: 'src-del' } });
    expect(remaining.map((r) => r.record.id)).toEqual(['del-b']);

    await store.delete({ tenantId: 'tenant-a', sourceId: 'src-del' });
    remaining = await store.search({ embedding: embedding(0.2), tenantId: 'tenant-a', topK: 10, filters: { sourceId: 'src-del' } });
    expect(remaining).toHaveLength(0);
  });

  it('rejects an embedding whose dimensions do not match the schema', async () => {
    const store = createPgVectorStore({ pool });
    await expect(store.upsert([record({ id: 'bad-dims', embedding: [1, 2, 3] })])).rejects.toThrow();
  });
});
