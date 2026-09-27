import { Queue, UnrecoverableError, Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { CopilotError } from '@gixcopilot/protocol';

/**
 * Serializable background jobs (Phase 12): unlike `createBullMQJobExecutor` (in-process step
 * closures), a job here is a *named kind plus JSON payload*, so a separate worker process can
 * run it. Producers enqueue; `apps/worker` registers handlers.
 */
export interface JobEnvelope<TPayload = unknown> {
  readonly kind: string;
  readonly payload: TPayload;
  /** The authenticated tenant the job acts for (set by the producer from its own context). */
  readonly tenantId?: string;
  readonly enqueuedAt: string;
}

export interface EnqueueOptions {
  /**
   * Stable key for duplicate suppression: the same `kind` + key while a job is queued, active or
   * recently completed resolves to the SAME job (Section 58). Use a business id
   * (e.g. `workflowRunId`, `sourceId:version`), never a random value.
   */
  readonly idempotencyKey: string;
  readonly tenantId?: string;
  /** Bounded attempts (default 3) with exponential backoff from `backoffMs` (default 1000). */
  readonly attempts?: number;
  readonly backoffMs?: number;
  readonly delayMs?: number;
}

export interface JobQueue {
  enqueue<TPayload>(kind: string, payload: TPayload, options: EnqueueOptions): Promise<{ readonly jobId: string; readonly duplicate: boolean }>;
  /** `queued | active | completed | failed | delayed | unknown`, persisted in Redis. */
  status(jobId: string): Promise<string>;
  close(): Promise<void>;
}

export interface CreateJobQueueOptions {
  readonly connection: ConnectionOptions;
  readonly queueName?: string;
  /** How long completed jobs are kept for duplicate suppression (default 24h). */
  readonly keepCompletedSeconds?: number;
  /** How many failed (dead-lettered) jobs are kept for inspection (default 10k). */
  readonly keepFailed?: number;
}

const KEY = /^[A-Za-z0-9._:-]{1,200}$/;

export function jobIdFor(kind: string, idempotencyKey: string): string {
  if (!KEY.test(kind) || !KEY.test(idempotencyKey)) throw CopilotError.validation('Invalid job kind or idempotency key.');
  // BullMQ reserves ':' in custom ids; encode it.
  return `${kind}__${idempotencyKey}`.replaceAll(':', '~');
}

export function createJobQueue(options: CreateJobQueueOptions): JobQueue {
  const queue = new Queue<JobEnvelope>(options.queueName ?? 'aicopilot-jobs', {
    connection: options.connection,
    defaultJobOptions: {
      removeOnComplete: { age: options.keepCompletedSeconds ?? 86_400 },
      removeOnFail: { count: options.keepFailed ?? 10_000 },
    },
  });
  return {
    async enqueue(kind, payload, enqueueOptions) {
      const jobId = jobIdFor(kind, enqueueOptions.idempotencyKey);
      const existing = await queue.getJob(jobId);
      if (existing) return { jobId, duplicate: true };
      const attempts = enqueueOptions.attempts ?? 3;
      if (!Number.isInteger(attempts) || attempts < 1 || attempts > 25) throw CopilotError.validation('attempts must be between 1 and 25.');
      await queue.add(
        kind,
        { kind, payload, tenantId: enqueueOptions.tenantId, enqueuedAt: new Date().toISOString() },
        { jobId, attempts, backoff: { type: 'exponential', delay: enqueueOptions.backoffMs ?? 1000 }, delay: enqueueOptions.delayMs },
      );
      return { jobId, duplicate: false };
    },
    async status(jobId) {
      const job = await queue.getJob(jobId);
      if (!job) return 'unknown';
      const state = await job.getState();
      return state === 'waiting' || state === 'prioritized' || state === 'waiting-children' ? 'queued' : state;
    },
    close: () => queue.close(),
  };
}

export interface JobContext {
  readonly jobId: string;
  /** 1-based attempt number. */
  readonly attempt: number;
  readonly tenantId?: string;
  /** Aborted on `cancel(jobId)` and on graceful shutdown timeout. Check it between side effects. */
  readonly signal: AbortSignal;
}

export type JobHandler<TPayload = unknown> = (payload: TPayload, context: JobContext) => Promise<void>;

/** Thrown (or a non-retryable `CopilotError`) to dead-letter a job immediately, without retries. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

function isPermanent(error: unknown): boolean {
  if (error instanceof PermanentJobError) return true;
  return CopilotError.isCopilotError(error) && !error.retryable;
}

export interface JobWorkerObserver {
  onCompleted?(kind: string, jobId: string, durationMs: number): void;
  onFailed?(kind: string, jobId: string, reason: string, willRetry: boolean): void;
}

export interface CreateJobWorkerOptions {
  readonly connection: ConnectionOptions;
  readonly queueName?: string;
  readonly handlers: Readonly<Record<string, JobHandler<never>>>;
  readonly concurrency?: number;
  readonly observer?: JobWorkerObserver;
}

export interface JobWorker {
  readonly ready: Promise<void>;
  /** Signals the handler of an active job to stop (it should stop at a safe point). */
  cancel(jobId: string): boolean;
  /**
   * Graceful shutdown: stop taking new jobs, wait up to `timeoutMs` for active ones, then abort
   * the rest (they are retried later by another worker, so handlers must be idempotent).
   */
  close(timeoutMs?: number): Promise<void>;
}

/**
 * Runs jobs by kind. Unknown kinds and permanent errors dead-letter immediately; other errors
 * retry with the job's bounded exponential backoff and dead-letter when exhausted (the failed
 * set, inspected with `createDeadLetterInspector`).
 */
export function createJobWorker(options: CreateJobWorkerOptions): JobWorker {
  const worker = new Worker<JobEnvelope>(
    options.queueName ?? 'aicopilot-jobs',
    async (job: Job<JobEnvelope>, _token?: string, signal?: AbortSignal) => {
      const started = Date.now();
      const handler = options.handlers[job.data.kind];
      if (!handler) throw new UnrecoverableError(`No handler registered for job kind "${job.data.kind}"`);
      try {
        await (handler as JobHandler)(job.data.payload, {
          jobId: job.id ?? '',
          attempt: job.attemptsMade + 1,
          tenantId: job.data.tenantId,
          signal: signal ?? new AbortController().signal,
        });
        options.observer?.onCompleted?.(job.data.kind, job.id ?? '', Date.now() - started);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const permanent = isPermanent(error);
        options.observer?.onFailed?.(job.data.kind, job.id ?? '', message, !permanent && job.attemptsMade + 1 < (job.opts.attempts ?? 1));
        if (permanent) throw new UnrecoverableError(message);
        throw error;
      }
    },
    { connection: options.connection, concurrency: options.concurrency ?? 4 },
  );
  const ready = worker.waitUntilReady().then(() => undefined);
  ready.catch(() => undefined);
  return {
    ready,
    cancel: (jobId) => worker.cancelJob(jobId),
    async close(timeoutMs = 25_000) {
      const closing = worker.close();
      const timer = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs).unref());
      if ((await Promise.race([closing.then(() => 'closed' as const), timer])) === 'timeout') {
        worker.cancelAllJobs('shutdown');
        await worker.close(true);
      }
    },
  };
}
