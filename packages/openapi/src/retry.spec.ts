import { describe, expect, it, vi } from 'vitest';
import { retryDelayMs, shouldRetry, withRetry } from './retry.js';

describe('shouldRetry', () => {
  it('never retries by default (maxAttempts defaults to 1)', () => {
    expect(shouldRetry({ method: 'get', attempt: 1, hasIdempotencyKey: false, status: 503, policy: {} })).toBe(false);
  });

  it('retries a GET on a retryable status when maxAttempts allows it', () => {
    expect(
      shouldRetry({ method: 'get', attempt: 1, hasIdempotencyKey: false, status: 503, policy: { maxAttempts: 3 } }),
    ).toBe(true);
  });

  it('does not retry once maxAttempts is reached', () => {
    expect(
      shouldRetry({ method: 'get', attempt: 3, hasIdempotencyKey: false, status: 503, policy: { maxAttempts: 3 } }),
    ).toBe(false);
  });

  it('never retries a POST without an idempotency key, even with retries enabled', () => {
    expect(
      shouldRetry({ method: 'post', attempt: 1, hasIdempotencyKey: false, status: 503, policy: { maxAttempts: 5 } }),
    ).toBe(false);
  });

  it('retries a POST with an idempotency key', () => {
    expect(
      shouldRetry({ method: 'post', attempt: 1, hasIdempotencyKey: true, status: 503, policy: { maxAttempts: 3 } }),
    ).toBe(true);
  });

  it('does not retry a non-retryable status', () => {
    expect(
      shouldRetry({ method: 'get', attempt: 1, hasIdempotencyKey: false, status: 404, policy: { maxAttempts: 3 } }),
    ).toBe(false);
  });

  it('retries a network error on an idempotent method', () => {
    expect(
      shouldRetry({ method: 'get', attempt: 1, hasIdempotencyKey: false, isNetworkError: true, policy: { maxAttempts: 3 } }),
    ).toBe(true);
  });

  it('respects a custom retryableStatuses list', () => {
    expect(
      shouldRetry({ method: 'get', attempt: 1, hasIdempotencyKey: false, status: 500, policy: { maxAttempts: 3, retryableStatuses: [500] } }),
    ).toBe(true);
  });
});

describe('retryDelayMs', () => {
  it('doubles the base delay per attempt', () => {
    expect(retryDelayMs(1, { baseDelayMs: 100 })).toBe(100);
    expect(retryDelayMs(2, { baseDelayMs: 100 })).toBe(200);
    expect(retryDelayMs(3, { baseDelayMs: 100 })).toBe(400);
  });

  it('defaults the base delay to 200ms', () => {
    expect(retryDelayMs(1, {})).toBe(200);
  });
});

describe('withRetry', () => {
  it('returns the first successful result without retrying', async () => {
    const attemptOnce = vi.fn(() => Promise.resolve('ok'));
    const delay = vi.fn(() => Promise.resolve());
    const result = await withRetry('get', false, { maxAttempts: 3 }, attemptOnce, () => ({}), delay);
    expect(result).toBe('ok');
    expect(attemptOnce).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('retries a retryable result up to maxAttempts, then returns the last result', async () => {
    let calls = 0;
    const attemptOnce = vi.fn(() => {
      calls += 1;
      return Promise.resolve(calls < 3 ? 503 : 200);
    });
    const delay = vi.fn(() => Promise.resolve());
    const result = await withRetry(
      'get',
      false,
      { maxAttempts: 3 },
      attemptOnce,
      (status) => ({ retryableStatus: status === 200 ? undefined : status }),
      delay,
    );
    expect(result).toBe(200);
    expect(attemptOnce).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
  });

  it('stops retrying and returns the last retryable result once maxAttempts is exhausted', async () => {
    const attemptOnce = vi.fn(() => Promise.resolve(503));
    const delay = vi.fn(() => Promise.resolve());
    const result = await withRetry(
      'get',
      false,
      { maxAttempts: 2 },
      attemptOnce,
      (status) => ({ retryableStatus: status }),
      delay,
    );
    expect(result).toBe(503);
    expect(attemptOnce).toHaveBeenCalledTimes(2);
  });

  it('never retries a non-idempotent POST without an idempotency key, even on a retryable status', async () => {
    const attemptOnce = vi.fn(() => Promise.resolve(503));
    const result = await withRetry(
      'post',
      false,
      { maxAttempts: 3 },
      attemptOnce,
      (status) => ({ retryableStatus: status }),
      vi.fn(() => Promise.resolve()),
    );
    expect(result).toBe(503);
    expect(attemptOnce).toHaveBeenCalledTimes(1);
  });

  it('retries a thrown network error and re-throws once retries are exhausted', async () => {
    const attemptOnce = vi.fn(() => {
      throw new Error('network down');
    });
    const delay = vi.fn(() => Promise.resolve());
    await expect(
      withRetry('get', false, { maxAttempts: 2 }, attemptOnce, () => ({}), delay),
    ).rejects.toThrow('network down');
    expect(attemptOnce).toHaveBeenCalledTimes(2);
  });
});


it('interrupts retry backoff on cancellation without issuing another request', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = withRetry('get', false, { maxAttempts: 3, baseDelayMs: 1000 }, () => { calls++; return Promise.resolve(503); }, (status) => ({ retryableStatus: status }), undefined, controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(calls).toBe(1);
});
