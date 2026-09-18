export interface RetryPolicy {
  /** Total attempts including the first, non-retry one. 1 means "never retry". */
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 2_000,
};

/**
 * Bounded exponential backoff with jitter. `attempt` is the 1-based attempt that just
 * failed. `random` is injectable so tests can make delays deterministic without faking
 * timers - in practice most tests instead just set `baseDelayMs`/`maxDelayMs` to 0.
 */
export function computeBackoffDelayMs(
  policy: RetryPolicy,
  attempt: number,
  random: () => number = Math.random,
): number {
  const exponential = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, policy.maxDelayMs);
  const jitterFactor = 0.5 + random() * 0.5;
  return Math.round(capped * jitterFactor);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted === true) {
    return Promise.resolve();
  }
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
