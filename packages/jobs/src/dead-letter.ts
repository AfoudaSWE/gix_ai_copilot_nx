import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';

export interface DeadLetterEntry {
  readonly jobId: string;
  readonly failedReason: string | undefined;
  readonly attemptsMade: number;
  readonly data: unknown;
  readonly timestamp: number;
}

export interface DeadLetterInspector {
  list(limit?: number): Promise<readonly DeadLetterEntry[]>;
  get(jobId: string): Promise<DeadLetterEntry | undefined>;
  /** Re-enqueues the same job id for another attempt - a deliberate, visible human/operator
   * action (Section 224), never automatic. */
  replay(jobId: string): Promise<void>;
  /** Permanently discards a dead-lettered job's record. */
  discard(jobId: string): Promise<void>;
}

/**
 * A dead-lettered job is inspectable, not silently discarded (Section 224). Reads BullMQ's
 * own `failed` job set for the queue - no separate dead-letter queue/table is introduced,
 * since BullMQ already retains failed jobs (with `removeOnFail: false`, set by
 * `createBullMQJobExecutor`) exactly for this purpose.
 */
export function createDeadLetterInspector(
  connection: ConnectionOptions,
  queueName = 'workflow-steps',
): DeadLetterInspector {
  const queue = new Queue(queueName, { connection });

  return {
    async list(limit = 50) {
      const jobs = await queue.getFailed(0, limit - 1);
      return jobs.map((job) => ({
        jobId: job.id ?? '',
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
        data: job.data as unknown,
        timestamp: job.timestamp,
      }));
    },
    async get(jobId) {
      const job = await queue.getJob(jobId);
      if (!job) return undefined;
      const state = await job.getState();
      if (state !== 'failed') return undefined;
      return {
        jobId: job.id ?? '',
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
        data: job.data as unknown,
        timestamp: job.timestamp,
      };
    },
    async replay(jobId) {
      const job = await queue.getJob(jobId);
      if (!job) return;
      await job.retry('failed');
    },
    async discard(jobId) {
      const job = await queue.getJob(jobId);
      await job?.remove();
    },
  };
}
