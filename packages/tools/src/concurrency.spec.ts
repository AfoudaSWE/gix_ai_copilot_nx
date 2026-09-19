import { describe, expect, it } from 'vitest';
import { planConcurrency, runWithConcurrencyPlan } from './concurrency.js';

describe('planConcurrency', () => {
  it('plans parallel when every call is parallel-safe (or unspecified)', () => {
    expect(planConcurrency([undefined, 'parallel-safe'])).toBe('parallel');
  });

  it('plans sequential when any call in the batch is serial or exclusive', () => {
    expect(planConcurrency(['parallel-safe', 'serial'])).toBe('sequential');
    expect(planConcurrency(['exclusive'])).toBe('sequential');
  });
});

describe('runWithConcurrencyPlan', () => {
  it('runs parallel-safe items concurrently, results ordered like the input', async () => {
    const order: string[] = [];
    const results = await runWithConcurrencyPlan(
      ['a', 'b'],
      () => 'parallel-safe',
      async (item) => {
        if (item === 'a') await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(item);
        return item.toUpperCase();
      },
    );
    expect(results).toEqual(['A', 'B']);
    // 'b' finishes first in real time, proving they ran concurrently, not sequentially.
    expect(order).toEqual(['b', 'a']);
  });

  it('runs items sequentially, in order, when any item is not parallel-safe', async () => {
    const order: string[] = [];
    const results = await runWithConcurrencyPlan(
      ['a', 'b'],
      (item) => (item === 'a' ? 'exclusive' : 'parallel-safe'),
      async (item) => {
        if (item === 'a') await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(item);
        return item.toUpperCase();
      },
    );
    expect(results).toEqual(['A', 'B']);
    expect(order).toEqual(['a', 'b']);
  });

  it('propagates a mixed batch failure without corrupting the ordering of the successful results', async () => {
    await expect(
      runWithConcurrencyPlan(
        ['ok', 'fail'],
        () => 'parallel-safe',
        (item) => {
          if (item === 'fail') throw new Error('boom');
          return Promise.resolve(item);
        },
      ),
    ).rejects.toThrow('boom');
  });
});
