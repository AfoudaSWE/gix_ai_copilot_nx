import { Queue, QueueEvents, Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { CopilotError } from '@gixcopilot/protocol';
import type { JobExecutor } from '@gixcopilot/workflows';

export interface CreateBullMQJobExecutorOptions {
  readonly connection: ConnectionOptions;
  readonly queueName?: string;
  readonly concurrency?: number;
  /**
   * BullMQ's own job-level retry count (Section 117-119) - kept at `1` by default so it
   * never duplicates `@gixcopilot/workflows`' own `RetryPolicy`, which is authoritative and
   * already re-schedules a fresh job (with a new attempt number baked into the job id) for
   * each retry. Raise this only if you specifically want BullMQ's own stalled-job recovery
   * *within the same process* as a second line of defense (see this module's doc comment for
   * exactly what that does and does not cover).
   */
  readonly defaultAttempts?: number;
}

export interface BullMQJobExecutor extends JobExecutor {
  close(): Promise<void>;
}

/**
 * A real, Redis-backed `JobExecutor` (Section 111-113): every `schedule()` call enqueues one
 * genuine BullMQ job, processed by a real `Worker`, with real job status persisted in Redis
 * (Section 87) - not a simulation. `@gixcopilot/workflows`' `JobExecutor.schedule(jobId, work)`
 * takes an in-process closure (`work`), which is fundamentally not serializable across a
 * process boundary; this adapter is honest about the resulting boundary rather than pretending
 * otherwise:
 *
 * - **What IS cross-process-durable**: the workflow's own state. `@gixcopilot/checkpoint-postgres`
 *   persists a checkpoint after every step, and `engine.resume(workflowRunId)` reconstructs
 *   everything needed to continue from nothing but that checkpoint plus the re-registered
 *   workflow definition (Section 198, 209) - proven in checkpoint-postgres's own Testcontainers
 *   suite. This is the actual crash-recovery boundary the architecture relies on.
 * - **What this executor adds on top**: real Redis-backed queuing/backpressure/concurrency
 *   control for scheduling step work asynchronously (Section 110's "survives the request
 *   ending"), and a genuine, inspectable dead-letter queue (`dead-letter.ts`) for a step whose
 *   job-level attempts are exhausted.
 * - **What it does NOT provide**: if the worker PROCESS itself dies mid-step (not just the
 *   step failing), a redelivered BullMQ job for that same closure has nothing to call in a
 *   fresh process (the closure lived only in that process's memory) - the worker below
 *   recognizes this case and completes the job as a no-op rather than erroring forever, and
 *   the workflow's own next `resume()` call (driven by the checkpoint, not by this queue) is
 *   what actually continues the run correctly.
 */
export function createBullMQJobExecutor(options: CreateBullMQJobExecutorOptions): BullMQJobExecutor {
  const queueName = options.queueName ?? 'workflow-steps';
  const queue = new Queue(queueName, { connection: options.connection });
  const queueEvents = new QueueEvents(queueName, { connection: options.connection });
  const pending = new Map<string, () => Promise<void>>();

  const worker = new Worker(
    queueName,
    async (job: Job) => {
      const jobId = job.id ?? '';
      const work = pending.get(jobId);
      if (!work) {
        // Redelivered with no closure to run in this process - see module doc comment.
        return;
      }
      await work();
    },
    { connection: options.connection, concurrency: options.concurrency ?? 1 },
  );
  const workerReady = worker.waitUntilReady();

  return {
    async schedule(jobId, work) {
      await workerReady;
      pending.set(jobId, work);
      try {
        const job = await queue.add(
          'step',
          {},
          {
            jobId,
            attempts: options.defaultAttempts ?? 1,
            removeOnComplete: true,
            // Kept for the dead-letter inspector (Section 224) - a failed job is a diagnosable
            // record, not silently discarded.
            removeOnFail: false,
          },
        );
        try {
          await job.waitUntilFinished(queueEvents);
        } catch (caught) {
          throw CopilotError.isCopilotError(caught)
            ? caught
            : CopilotError.workflowStepExecutionError(
                caught instanceof Error ? caught.message : String(caught),
                { jobId },
              );
        }
      } finally {
        pending.delete(jobId);
      }
    },

    async close() {
      await worker.close();
      await queueEvents.close();
      await queue.close();
    },
  };
}
