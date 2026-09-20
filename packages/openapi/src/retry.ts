import { setTimeout as wait } from 'node:timers/promises';
import type { HttpMethod } from './types.js';

/** Methods safe to retry unconditionally (Section 55) - `GET`/`HEAD`/`OPTIONS` never mutate
 * state, so retrying a transient failure cannot double-apply an effect. `POST`/`PUT`/`PATCH`/
 * `DELETE` are only safe to retry when the call carries an idempotency key (Section 56) -
 * retrying them "blindly" is exactly what Section 55 prohibits. */
const IDEMPOTENT_METHODS: ReadonlySet<HttpMethod> = new Set(['get', 'head', 'options']);

/** HTTP statuses worth retrying by default when retries are enabled at all (Section 55's
 * "429 and some 5xx"): rate limiting and transient server-side failures. `500` is deliberately
 * excluded from the default set - an ordinary 500 often reflects an application bug that
 * retrying will not fix, whereas 502/503/504 are classic transient-gateway failures. */
const DEFAULT_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

export interface RetryPolicy {
  /** Total attempts including the first, e.g. `3` = up to 2 retries. Defaults to `1` (no
   * retries) - retries are opt-in, never silently enabled (Section 55). */
  readonly maxAttempts?: number;
  readonly retryableStatuses?: readonly number[];
  readonly baseDelayMs?: number;
}

export interface RetryDecisionInput {
  readonly method: HttpMethod;
  readonly attempt: number; // 1-indexed: the attempt that just finished
  readonly hasIdempotencyKey: boolean;
  readonly status?: number;
  readonly isNetworkError?: boolean;
  readonly policy: RetryPolicy;
}

/**
 * Pure decision function: should the caller retry after this attempt failed? Never retries a
 * non-idempotent method unless the call carries an idempotency key (Section 55-56) - a write
 * without one is retried zero times regardless of `maxAttempts`, because the SDK has no way to
 * know the external API can safely receive the same write twice (Section 56's "do not invent
 * idempotency guarantees when the external API does not provide them").
 */
export function shouldRetry(input: RetryDecisionInput): boolean {
  const maxAttempts = input.policy.maxAttempts ?? 1;
  if (input.attempt >= maxAttempts) return false;

  const methodIsSafe = IDEMPOTENT_METHODS.has(input.method) || input.hasIdempotencyKey;
  if (!methodIsSafe) return false;

  if (input.isNetworkError) return true;

  const retryableStatuses = new Set(input.policy.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES);
  return input.status !== undefined && retryableStatuses.has(input.status);
}

/** Exponential backoff with a fixed base (Section 55 does not mandate a specific curve; this
 * is deliberately simple - no jitter/circuit-breaker sophistication, matching "do not build a
 * complex production sync service" elsewhere in this phase's scope). */
export function retryDelayMs(attempt: number, policy: RetryPolicy): number {
  const base = policy.baseDelayMs ?? 200;
  return base * 2 ** (attempt - 1);
}

/**
 * Runs `attemptOnce` under a retry policy, retrying only when `shouldRetry` allows it.
 * `attemptOnce` receives the 1-indexed attempt number and must return either a value to
 * classify (via `classify`) as success/retryable-failure, or throw (treated as a network
 * error for retry purposes, then re-thrown if no more retries are allowed).
 */
export async function withRetry<T>(
  method: HttpMethod,
  hasIdempotencyKey: boolean,
  policy: RetryPolicy,
  attemptOnce: (attempt: number) => Promise<T>,
  classify: (result: T) => { readonly retryableStatus?: number },
  delay?: (ms: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<T> {
  const attempts = policy.maxAttempts ?? 1;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) throw new Error('Retry attempts must be between 1 and 10.');
  const backoff = delay ?? ((ms: number) => wait(ms, undefined, { signal }));
  const base = policy.baseDelayMs ?? 200;
  if (!Number.isFinite(base) || base < 0 || base > 30_000) throw new Error('Retry delay must be finite and between 0 and 30000ms.');
  let attempt = 0;
  for (;;) {
    signal?.throwIfAborted();
    attempt += 1;
    try {
      const result = await attemptOnce(attempt);
      const { retryableStatus } = classify(result);
      if (
        retryableStatus === undefined ||
        !shouldRetry({ method, attempt, hasIdempotencyKey, status: retryableStatus, policy })
      ) {
        return result;
      }
      await backoff(Math.min(retryDelayMs(attempt, policy), 30_000));
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name)) throw error;
      if (!shouldRetry({ method, attempt, hasIdempotencyKey, isNetworkError: true, policy })) throw error;
      await backoff(Math.min(retryDelayMs(attempt, policy), 30_000));
    }
  }
}
