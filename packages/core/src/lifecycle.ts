import { CopilotError, type RunStatus } from '@gixcopilot/protocol';

/**
 * The only valid transitions out of each status. An empty array means the status is
 * terminal. `created -> cancelled` is allowed so a run can be cancelled before it ever
 * starts executing (e.g. while still queued) without ever emitting `run.started`.
 *
 * Written as an exhaustive switch (not a `Record` lookup) so adding a new `RunStatus`
 * fails to compile here until its transitions are decided - see typescript-standards'
 * exhaustive-switch rule.
 */
function allowedTransitionsFrom(status: RunStatus): readonly RunStatus[] {
  switch (status) {
    case 'created':
      return ['running', 'cancelled'];
    case 'running':
      return ['completed', 'failed', 'cancelled'];
    case 'completed':
    case 'failed':
    case 'cancelled':
      return [];
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled run status: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export class RunLifecycle {
  #status: RunStatus = 'created';

  get status(): RunStatus {
    return this.#status;
  }

  get isTerminal(): boolean {
    return allowedTransitionsFrom(this.#status).length === 0;
  }

  /**
   * Throws a CopilotError (INTERNAL_ERROR) if `next` is not reachable from the current
   * status. This is a runtime-invariant guard, not a user-facing validation error - if it
   * ever throws, the runtime orchestrating it has a bug.
   */
  transitionTo(next: RunStatus): void {
    if (!allowedTransitionsFrom(this.#status).includes(next)) {
      throw CopilotError.internal(
        `Invalid run lifecycle transition: "${this.#status}" -> "${next}"`,
      );
    }
    this.#status = next;
  }

  canTransitionTo(next: RunStatus): boolean {
    return allowedTransitionsFrom(this.#status).includes(next);
  }
}
