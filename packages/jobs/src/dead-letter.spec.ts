import { execSync } from 'node:child_process';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import type { ConnectionOptions } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBullMQJobExecutor } from './bullmq-job-executor.js';
import { createDeadLetterInspector } from './dead-letter.js';

function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = isDockerAvailable();

async function waitFor<T>(check: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result !== undefined) return result;
    if (Date.now() > deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Real-Redis integration tests (Section 224, 226) for the dead-letter inspector - a failed
 * job's diagnosable record, and the deliberate, visible operator actions (`replay`/`discard`)
 * over it, verified against real BullMQ/Redis state, not mocked.
 */
describe.skipIf(!dockerAvailable)('createDeadLetterInspector (Testcontainers integration)', () => {
  let container: StartedRedisContainer;
  let connection: ConnectionOptions;

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    connection = { host: container.getHost(), port: container.getPort(), maxRetriesPerRequest: null };
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  it('lists, gets, and discards a job whose attempts were exhausted', async () => {
    const queueName = `jobs-deadletter-${Date.now()}`;
    const executor = createBullMQJobExecutor({ connection, queueName });
    try {
      await expect(
        executor.schedule('doomed', () => Promise.reject(new Error('always fails'))),
      ).rejects.toBeTruthy();
    } finally {
      await executor.close();
    }

    const inspector = createDeadLetterInspector(connection, queueName);
    const entry = await waitFor(() => inspector.get('doomed'));
    expect(entry).toBeDefined();
    expect(entry?.failedReason).toContain('always fails');

    const list = await inspector.list();
    expect(list.some((candidate) => candidate.jobId === 'doomed')).toBe(true);

    await inspector.discard('doomed');
    const afterDiscard = await inspector.get('doomed');
    expect(afterDiscard).toBeUndefined();
  }, 30_000);

  it('get() returns undefined for a job that never failed', async () => {
    const queueName = `jobs-deadletter-healthy-${Date.now()}`;
    const executor = createBullMQJobExecutor({ connection, queueName });
    try {
      await executor.schedule('healthy', () => Promise.resolve());
    } finally {
      await executor.close();
    }

    const inspector = createDeadLetterInspector(connection, queueName);
    expect(await inspector.get('healthy')).toBeUndefined();
  }, 30_000);

  it('replay moves a dead-lettered job out of the failed set (Section 224)', async () => {
    const queueName = `jobs-replay-${Date.now()}`;
    const executor = createBullMQJobExecutor({ connection, queueName });
    try {
      await expect(
        executor.schedule('replay-me', () => Promise.reject(new Error('fails once'))),
      ).rejects.toBeTruthy();
    } finally {
      await executor.close();
    }

    const inspector = createDeadLetterInspector(connection, queueName);
    expect(await waitFor(() => inspector.get('replay-me'))).toBeDefined();

    await inspector.replay('replay-me');

    // Once replayed, BullMQ re-runs the job - with no closure left to call in this fresh
    // inspection process (see bullmq-job-executor.ts's own doc comment on this exact
    // limitation), the worker treats it as a no-op and the job leaves the 'failed' state
    // rather than remaining dead-lettered forever.
    const executorForRedelivery = createBullMQJobExecutor({ connection, queueName });
    try {
      const stillFailed = await waitFor(() => inspector.get('replay-me'), 3_000);
      expect(stillFailed).toBeUndefined();
    } finally {
      await executorForRedelivery.close();
    }
  }, 30_000);

  it('discard on a non-existent job id is a safe no-op', async () => {
    const queueName = `jobs-discard-missing-${Date.now()}`;
    const inspector = createDeadLetterInspector(connection, queueName);
    await expect(inspector.discard('does-not-exist')).resolves.toBeUndefined();
  });
});
