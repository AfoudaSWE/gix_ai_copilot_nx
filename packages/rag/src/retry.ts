export interface RetryOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly shouldRetry?: (error: unknown) => boolean;
  /** Injectable for deterministic tests - defaults to a real timer. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly signal?: AbortSignal;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Small bounded exponential-backoff retry helper (Section 38/130) - used for embedding rate
 * limits and other transient infrastructure failures. Deliberately local to this package rather
 * than a new cross-package dependency for a handful of lines.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    options.signal?.throwIfAborted();
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable = options.shouldRetry ? options.shouldRetry(error) : true;
      if (!retryable || attempt === maxAttempts - 1) throw error;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}
