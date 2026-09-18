import { describe, expect, it } from 'vitest';
import { addUsage, createEmptyUsage } from './usage.js';

describe('usage', () => {
  it('createEmptyUsage starts at zero', () => {
    expect(createEmptyUsage()).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  it('addUsage sums each field independently', () => {
    const a = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
    const b = { inputTokens: 2, outputTokens: 3, totalTokens: 5 };
    expect(addUsage(a, b)).toEqual({ inputTokens: 12, outputTokens: 8, totalTokens: 20 });
  });
});
