import { execSync } from 'node:child_process';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import type { ConnectionOptions } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CopilotError } from '@gixcopilot/protocol';
import { PermanentJobError, createDeadLetterInspector, createJobQueue, createJobWorker, jobIdFor } from './index.js';
import type { JobWorker } from './index.js';

function dockerAvailable(): boolean {
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

async function until(predicate: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe.skipIf(!dockerAvailable())('serializable job queue + worker on real Redis', () => {
  let container: StartedRedisContainer;
  let connection: ConnectionOptions;
  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    connection = { host: container.getHost(), port: container.getPort(), maxRetriesPerRequest: null };
  }, 120_000);
  afterAll(async () => {
    await container?.stop();
  });

  it('two workers share the queue; each job runs once; duplicate enqueues are suppressed', async () => {
    const queueName = `q-scale-${Date.now()}`;
    const queue = createJobQueue({ connection, queueName });
    const processedBy: Record<string, string[]> = {};
    const handler = (name: string) => (payload: { id: string }) => {
      (processedBy[payload.id] ??= []).push(name);
      return new Promise<void>((resolve) => setTimeout(resolve, 20));
    };
    const workers: JobWorker[] = [
      createJobWorker({ connection, queueName, concurrency: 2, handlers: { 'knowledge.index': handler('w1') } }),
      createJobWorker({ connection, queueName, concurrency: 2, handlers: { 'knowledge.index': handler('w2') } }),
    ];
    await Promise.all(workers.map((worker) => worker.ready));
    for (let index = 0; index < 20; index += 1) {
      const first = await queue.enqueue('knowledge.index', { id: `doc-${index}` }, { idempotencyKey: `doc-${index}:v1`, tenantId: 'tenant-a' });
      const again = await queue.enqueue('knowledge.index', { id: `doc-${index}` }, { idempotencyKey: `doc-${index}:v1`, tenantId: 'tenant-a' });
      expect(again).toEqual({ jobId: first.jobId, duplicate: true });
    }
    await until(() => Object.keys(processedBy).length === 20);
    expect(Object.values(processedBy).every((runs) => runs.length === 1)).toBe(true);
    const workerNames = new Set(Object.values(processedBy).flat());
    expect(workerNames.size).toBe(2);
    // Completed jobs are retained for deduplication: re-enqueueing after completion is still a no-op.
    expect((await queue.enqueue('knowledge.index', { id: 'doc-0' }, { idempotencyKey: 'doc-0:v1' })).duplicate).toBe(true);
    expect(await queue.status(jobIdFor('knowledge.index', 'doc-0:v1'))).toBe('completed');
    await Promise.all(workers.map((worker) => worker.close()));
    await queue.close();
  });

  it('retries transient failures with backoff, dead-letters permanent ones immediately', async () => {
    const queueName = `q-retry-${Date.now()}`;
    const queue = createJobQueue({ connection, queueName });
    const attempts: Record<string, number> = {};
    const failures: { kind: string; willRetry: boolean }[] = [];
    const worker = createJobWorker({
      connection,
      queueName,
      observer: { onFailed: (kind, _id, _reason, willRetry) => failures.push({ kind, willRetry }) },
      handlers: {
        flaky: (_payload: unknown, context) => {
          attempts['flaky'] = context.attempt;
          return context.attempt < 3 ? Promise.reject(new Error('temporary outage')) : Promise.resolve();
        },
        broken: () => {
          attempts['broken'] = (attempts['broken'] ?? 0) + 1;
          return Promise.reject(new PermanentJobError('invalid document'));
        },
        denied: () => Promise.reject(CopilotError.validation('schema mismatch')),
        exhausted: () => Promise.reject(new Error('always down')),
      },
    });
    await worker.ready;
    await queue.enqueue('flaky', {}, { idempotencyKey: 'f1', attempts: 3, backoffMs: 10 });
    await queue.enqueue('broken', {}, { idempotencyKey: 'b1', attempts: 5, backoffMs: 10 });
    await queue.enqueue('denied', {}, { idempotencyKey: 'd1', attempts: 5, backoffMs: 10 });
    await queue.enqueue('exhausted', {}, { idempotencyKey: 'e1', attempts: 2, backoffMs: 10 });
    await queue.enqueue('unknown.kind', {}, { idempotencyKey: 'u1', attempts: 5, backoffMs: 10 });

    await until(async () => (await queue.status(jobIdFor('flaky', 'f1'))) === 'completed');
    expect(attempts['flaky']).toBe(3);
    const dlq = createDeadLetterInspector(connection, queueName);
    await until(async () => (await dlq.list()).length === 4);
    const entries = await dlq.list();
    const byId = Object.fromEntries(entries.map((entry) => [entry.jobId, entry]));
    expect(byId[jobIdFor('broken', 'b1')]?.attemptsMade).toBe(1);
    expect(attempts['broken']).toBe(1);
    expect(byId[jobIdFor('denied', 'd1')]?.attemptsMade).toBe(1);
    expect(byId[jobIdFor('exhausted', 'e1')]?.attemptsMade).toBe(2);
    expect(byId[jobIdFor('unknown.kind', 'u1')]?.failedReason).toMatch(/No handler/);
    expect((await queue.enqueue('broken', {}, { idempotencyKey: 'b1', attempts: 5 })).duplicate).toBe(true);
    expect(failures.filter((failure) => failure.kind === 'flaky').every((failure) => failure.willRetry)).toBe(true);
    await worker.close();
    await queue.close();
  });

  it('cancels an active job through its abort signal and shuts down gracefully', async () => {
    const queueName = `q-cancel-${Date.now()}`;
    const queue = createJobQueue({ connection, queueName });
    let aborted = false;
    let started = false;
    const worker = createJobWorker({
      connection,
      queueName,
      handlers: {
        long: (_payload: unknown, context) =>
          new Promise<void>((resolve, reject) => {
            started = true;
            context.signal.addEventListener('abort', () => {
              aborted = true;
              reject(new PermanentJobError('cancelled'));
            });
            setTimeout(resolve, 10_000);
          }),
      },
    });
    await worker.ready;
    const { jobId } = await queue.enqueue('long', {}, { idempotencyKey: 'l1', attempts: 1 });
    await until(() => started);
    expect(worker.cancel(jobId)).toBe(true);
    await until(() => aborted);
    await worker.close(1000);
    expect(await queue.status(jobId)).toBe('failed');
    await queue.close();
  });

  it('rejects unsafe job ids', () => {
    expect(() => jobIdFor('kind', '../../etc')).toThrow();
    expect(jobIdFor('workflow.resume', 'run:1')).toBe('workflow.resume__run~1');
  });
});
