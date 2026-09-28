import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorkflowCheckpoint } from '@gixcopilot/workflows';
import { createPgCheckpointStore } from './pg-checkpoint-store.js';

/**
 * Real-database integration tests (Section 152, 198, 209, 226-227), following
 * `@gixcopilot/vectorstore-pgvector`'s exact pattern: a genuine new Postgres dependency is
 * verified against Testcontainers, not mocked. Auto-skips when Docker is unreachable.
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

function checkpoint(overrides: Partial<WorkflowCheckpoint> & Pick<WorkflowCheckpoint, 'workflowRunId'>): WorkflowCheckpoint {
  const now = new Date().toISOString();
  return {
    workflowId: 'wf-1',
    workflowVersion: '1',
    status: 'running',
    state: { count: 0 },
    steps: [],
    version: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe.skipIf(!dockerAvailable)('createPgCheckpointStore (Testcontainers integration)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16').start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    await runMigration(pool);
  }, 180_000);

  beforeEach(async () => {
    await pool.query('TRUNCATE workflow_runs');
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('saves (insert), loads, and increments version on each subsequent save', async () => {
    const store = createPgCheckpointStore({ pool });
    const created = await store.save(checkpoint({ workflowRunId: 'run-1' }));
    expect(created.version).toBe(1);

    const loaded = await store.load('run-1');
    expect(loaded?.state).toEqual({ count: 0 });
    expect(loaded?.version).toBe(1);

    const updated = await store.save({ ...created, state: { count: 1 } });
    expect(updated.version).toBe(2);
    expect((await store.load('run-1'))?.state).toEqual({ count: 1 });
  });

  it('rejects a stale write with WORKFLOW_CHECKPOINT_VERSION_MISMATCH (Section 226-227)', async () => {
    const store = createPgCheckpointStore({ pool });
    const created = await store.save(checkpoint({ workflowRunId: 'run-2' }));

    // Two "workers" both read version 1 and try to save - only the first should win.
    await store.save({ ...created, state: { count: 1 } });
    await expect(store.save({ ...created, state: { count: 2 } })).rejects.toMatchObject({
      code: 'WORKFLOW_CHECKPOINT_VERSION_MISMATCH',
    });
  });

  it('survives a "process restart": a new store instance against the same database resumes correctly (Section 198, 209)', async () => {
    const store1 = createPgCheckpointStore({ pool });
    await store1.save(checkpoint({ workflowRunId: 'run-3', state: { step: 'first' } }));

    // A brand-new store instance, as a new process would create.
    const store2 = createPgCheckpointStore({ pool });
    const loaded = await store2.load('run-3');
    expect(loaded).toBeDefined();
    expect(loaded?.state).toEqual({ step: 'first' });

    const resumed = await store2.save({ ...(loaded as WorkflowCheckpoint), state: { step: 'second' }, status: 'completed' });
    expect(resumed.status).toBe('completed');
    expect((await store1.load('run-3'))?.state).toEqual({ step: 'second' });
  });

  it('deletes a checkpoint', async () => {
    const store = createPgCheckpointStore({ pool });
    await store.save(checkpoint({ workflowRunId: 'run-4' }));
    await store.delete('run-4');
    expect(await store.load('run-4')).toBeUndefined();
  });

  it('lists checkpoints filtered by workflowId and tenantId (Section 129-130 - the SQL-level tenant scoping a caller layers isolation on top of)', async () => {
    const store = createPgCheckpointStore({ pool });
    await store.save(checkpoint({ workflowRunId: 'run-a1', workflowId: 'wf-a', tenantId: 'tenant-a' }));
    await store.save(checkpoint({ workflowRunId: 'run-a2', workflowId: 'wf-a', tenantId: 'tenant-b' }));
    await store.save(checkpoint({ workflowRunId: 'run-b1', workflowId: 'wf-b', tenantId: 'tenant-a' }));

    const byTenant = await store.list({ tenantId: 'tenant-a' });
    expect(byTenant.map((c) => c.workflowRunId).sort()).toEqual(['run-a1', 'run-b1']);

    const byWorkflow = await store.list({ workflowId: 'wf-a' });
    expect(byWorkflow.map((c) => c.workflowRunId).sort()).toEqual(['run-a1', 'run-a2']);
  });
});
