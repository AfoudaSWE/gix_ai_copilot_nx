import type { PublicCopilotError } from '@gixcopilot/protocol';

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly backoffMs?: (attempt: number) => number;
  /** Overrides the default retryable-vs-not decision (Section 117-119). Defaults to the
   * error's own `retryable` flag - the exact same signal `@gixcopilot/provider`'s model
   * retry already uses, never re-derived per error code here. */
  readonly isRetryable?: (error: PublicCopilotError) => boolean;
}

export const DEFAULT_WORKFLOW_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoffMs: (attempt) => Math.min(1000 * 2 ** (attempt - 1), 10_000),
};

export function isStepErrorRetryable(error: PublicCopilotError, policy: RetryPolicy): boolean {
  return policy.isRetryable ? policy.isRetryable(error) : error.retryable;
}

export function computeStepBackoffMs(policy: RetryPolicy, attempt: number): number {
  return policy.backoffMs ? policy.backoffMs(attempt) : 0;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
