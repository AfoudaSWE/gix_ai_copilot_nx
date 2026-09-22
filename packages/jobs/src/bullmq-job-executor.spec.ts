import { execSync } from 'node:child_process';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import type { ConnectionOptions } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBullMQJobExecutor } from './bullmq-job-executor.js';
import type { BullMQJobExecutor } from './bullmq-job-executor.js';

/**
 * Real-Redis integration tests (Section 111-116, 226), following
 * `@gixcopilot/checkpoint-postgres`'s exact pattern: a genuine new Redis dependency is
 * verified against Testcontainers, not mocked. Auto-skips when Docker is unreachable.
 */
function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = isDockerAvailable();

describe.skipIf(!dockerAvailable)('createBullMQJobExecutor (Testcontainers integration)', () => {
  let container: StartedRedisContainer;
  let connection: ConnectionOptions;

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    connection = { host: container.getHost(), port: container.getPort(), maxRetriesPerRequest: null };
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  it('actually runs the scheduled closure through a real Redis-backed queue and worker', async () => {
    const executor = createBullMQJobExecutor({ connection, queueName: `jobs-basic-${Date.now()}` });
    try {
      let ran = false;
      await executor.schedule('job-1', () => {
        ran = true;
        return Promise.resolve();
      });
      expect(ran).toBe(true);
    } finally {
      await executor.close();
    }
  }, 30_000);

  it('propagates the closure error back to the caller as a CopilotError', async () => {
    const executor = createBullMQJobExecutor({ connection, queueName: `jobs-error-${Date.now()}` });
    try {
      await expect(
        executor.schedule('job-fail', () => Promise.reject(new Error('boom'))),
      ).rejects.toMatchObject({ code: 'WORKFLOW_STEP_EXECUTION_ERROR' });
    } finally {
      await executor.close();
    }
  }, 30_000);

  /** Mandatory (Section 116): retries must not duplicate a consequential action - scheduling
   * the exact same job id twice runs the underlying work at most once. */
  it('a repeated schedule() call with the same job id does not run the work twice', async () => {
    const executor = createBullMQJobExecutor({ connection, queueName: `jobs-idempotent-${Date.now()}` });
    try {
      let runCount = 0;
      const work = () => {
        runCount += 1;
        return Promise.resolve();
      };
      await Promise.all([executor.schedule('same-id', work), executor.schedule('same-id', work)]);
      expect(runCount).toBe(1);
    } finally {
      await executor.close();
    }
  }, 30_000);

  it('runs multiple distinct jobs concurrently up to the configured concurrency', async () => {
    const executor = createBullMQJobExecutor({
      connection,
      queueName: `jobs-concurrent-${Date.now()}`,
      concurrency: 3,
    });
    try {
      const order: string[] = [];
      await Promise.all([
        executor.schedule('a', () => {
          order.push('a');
          return Promise.resolve();
        }),
        executor.schedule('b', () => {
          order.push('b');
          return Promise.resolve();
        }),
        executor.schedule('c', () => {
          order.push('c');
          return Promise.resolve();
        }),
      ]);
      expect(order.sort()).toEqual(['a', 'b', 'c']);
    } finally {
      await executor.close();
    }
  }, 30_000);

  it('close() shuts down cleanly and can be called on an executor that never scheduled anything', async () => {
    const executor: BullMQJobExecutor = createBullMQJobExecutor({ connection, queueName: `jobs-close-${Date.now()}` });
    await expect(executor.close()).resolves.toBeUndefined();
  }, 30_000);
});
