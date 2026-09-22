/**
 * The background-execution port (Section 111-113). The workflow engine's unit of scheduled
 * work is one step (`schedule()` is called once per step advance, see engine.ts), so a real
 * BullMQ adapter (`@gixcopilot/jobs`) can enqueue exactly one job per step - a worker crash
 * loses at most that one in-flight step's progress, resumed from the last checkpoint, never
 * the whole run. `createInlineJobExecutor` (the default) simply awaits the work in-process,
 * so the engine requires no Redis/BullMQ dependency to run at all (Section 113, 221).
 */
export interface JobExecutor {
  /** `jobId` should be stable/idempotent (Section 116) - the engine derives it from
   * `${workflowRunId}:${stepId}:${attempt}`, so at-least-once redelivery of the same job
   * cannot double-run a step's side effect at the queue level. */
  schedule(jobId: string, work: () => Promise<void>): Promise<void>;
}

export function createInlineJobExecutor(): JobExecutor {
  return {
    async schedule(_jobId, work) {
      await work();
    },
  };
}

export function workflowStepJobId(workflowRunId: string, stepId: string, attempt: number): string {
  return `${workflowRunId}:${stepId}:${attempt}`;
}
