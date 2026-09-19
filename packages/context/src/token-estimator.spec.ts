import { describe, expect, it } from 'vitest';
import { createDefaultTokenEstimator } from './token-estimator.js';

describe('createDefaultTokenEstimator', () => {
  const estimator = createDefaultTokenEstimator();

  it('returns 0 for empty text', () => {
    expect(estimator.estimate('')).toBe(0);
  });

  it('estimates roughly 4 characters per token, rounded up, minimum 1', () => {
    expect(estimator.estimate('a')).toBe(1);
    expect(estimator.estimate('abcd')).toBe(1);
    expect(estimator.estimate('abcde')).toBe(2);
    expect(estimator.estimate('x'.repeat(400))).toBe(100);
  });

  it('is deterministic for the same input', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    expect(estimator.estimate(text)).toBe(estimator.estimate(text));
  });
});
