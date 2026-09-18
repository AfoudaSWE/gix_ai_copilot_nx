import { describe, expect, it } from 'vitest';
import { computeBackoffDelayMs, sleep } from './retry.js';

describe('computeBackoffDelayMs', () => {
  it('grows exponentially with the attempt number, before the cap', () => {
    const policy = { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 10_000 };
    const noJitter = () => 0; // jitterFactor = 0.5, i.e. exactly half of the capped value
    expect(computeBackoffDelayMs(policy, 1, noJitter)).toBe(50);
    expect(computeBackoffDelayMs(policy, 2, noJitter)).toBe(100);
    expect(computeBackoffDelayMs(policy, 3, noJitter)).toBe(200);
  });

  it('never exceeds maxDelayMs regardless of how large the attempt number is', () => {
    const policy = { maxAttempts: 20, baseDelayMs: 100, maxDelayMs: 500 };
    const noJitter = () => 1; // jitterFactor = 1.0, i.e. exactly the capped value
    expect(computeBackoffDelayMs(policy, 10, noJitter)).toBe(500);
  });

  it('is deterministic for a fixed random function', () => {
    const policy = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1_000 };
    const fixed = () => 0.25;
    expect(computeBackoffDelayMs(policy, 2, fixed)).toBe(computeBackoffDelayMs(policy, 2, fixed));
  });
});

describe('sleep', () => {
  it('resolves immediately for a non-positive duration', async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
    await expect(sleep(-5)).resolves.toBeUndefined();
  });

  it('resolves immediately if the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(10_000, controller.signal)).resolves.toBeUndefined();
  });

  it('resolves early if aborted mid-sleep, without waiting out the full duration', async () => {
    const controller = new AbortController();
    const promise = sleep(10_000, controller.signal);
    controller.abort();
    await expect(promise).resolves.toBeUndefined();
  });
});
