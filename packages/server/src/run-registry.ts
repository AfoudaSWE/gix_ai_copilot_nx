import type { RuntimeRun } from '@gixcopilot/core';
import type { RunId } from '@gixcopilot/protocol';

/**
 * In-memory registry of in-flight runs, keyed by RunId, so `POST /runs/:runId/cancel` can
 * find and cancel a run created by a separate request. This is intentionally process-local
 * and non-persistent - see the server package README's "Non-responsibilities": a
 * multi-instance deployment needs a shared registry (e.g. Redis-backed), which is out of
 * scope for Phase 1.
 */
export interface RunRegistry {
  register(run: RuntimeRun): void;
  unregister(runId: RunId): void;
  get(runId: RunId): RuntimeRun | undefined;
  /** Cancels every currently-registered run - used for graceful shutdown. */
  cancelAll(): void;
}

export function createRunRegistry(): RunRegistry {
  const runs = new Map<RunId, RuntimeRun>();

  return {
    register(run) {
      runs.set(run.runId, run);
    },
    unregister(runId) {
      runs.delete(runId);
    },
    get(runId) {
      return runs.get(runId);
    },
    cancelAll() {
      for (const run of runs.values()) {
        run.cancel();
      }
    },
  };
}
