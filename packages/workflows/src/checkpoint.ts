import { CopilotError } from '@gixcopilot/protocol';
import type { WorkflowCheckpoint } from './state.js';

export interface CheckpointListFilter {
  readonly workflowId?: string;
  readonly tenantId?: string;
}

/**
 * The persistence port (Section 102) `@gixcopilot/workflows` depends on as an interface only
 * - never on Postgres/Redis directly (Section 220-221). `@gixcopilot/checkpoint-postgres`
 * implements this for real durability; `createInMemoryCheckpointStore` is the default so the
 * engine runs with zero external dependencies out of the box.
 */
export interface CheckpointStore {
  /** Creates (version 0 -> 1) or updates (compare-and-swap on `version`) a checkpoint.
   * Returns the persisted checkpoint with its incremented `version`. Throws
   * `WORKFLOW_CHECKPOINT_VERSION_MISMATCH` if `checkpoint.version` does not match what is
   * currently stored (Section 226: prevents two workers resuming the same run at once). */
  save<TState>(checkpoint: WorkflowCheckpoint<TState>): Promise<WorkflowCheckpoint<TState>>;
  load<TState>(workflowRunId: string): Promise<WorkflowCheckpoint<TState> | undefined>;
  delete(workflowRunId: string): Promise<void>;
  list(filter?: CheckpointListFilter): Promise<readonly WorkflowCheckpoint[]>;
}

export function createInMemoryCheckpointStore(): CheckpointStore {
  const checkpoints = new Map<string, WorkflowCheckpoint>();

  return {
    save<TState>(checkpoint: WorkflowCheckpoint<TState>): Promise<WorkflowCheckpoint<TState>> {
      const existing = checkpoints.get(checkpoint.workflowRunId);
      const expectedVersion = existing?.version ?? 0;
      if (checkpoint.version !== expectedVersion) {
        throw CopilotError.workflowCheckpointVersionMismatch(
          checkpoint.workflowRunId,
          expectedVersion,
          checkpoint.version,
        );
      }
      const persisted: WorkflowCheckpoint<TState> = { ...checkpoint, version: expectedVersion + 1 };
      checkpoints.set(checkpoint.workflowRunId, persisted);
      return Promise.resolve(persisted);
    },
    load<TState>(workflowRunId: string): Promise<WorkflowCheckpoint<TState> | undefined> {
      return Promise.resolve(checkpoints.get(workflowRunId) as WorkflowCheckpoint<TState> | undefined);
    },
    delete(workflowRunId: string): Promise<void> {
      checkpoints.delete(workflowRunId);
      return Promise.resolve();
    },
    list(filter?: CheckpointListFilter): Promise<readonly WorkflowCheckpoint[]> {
      const all = Array.from(checkpoints.values());
      return Promise.resolve(
        all.filter(
          (checkpoint) =>
            (!filter?.workflowId || checkpoint.workflowId === filter.workflowId) &&
            (!filter?.tenantId || checkpoint.tenantId === filter.tenantId),
        ),
      );
    },
  };
}
