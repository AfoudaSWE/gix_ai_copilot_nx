import { describe, expect, it } from 'vitest';
import { createTruncatingCompressor } from './context-compressor.js';
import { createDefaultTokenEstimator } from './token-estimator.js';

describe('createTruncatingCompressor', () => {
  const estimator = createDefaultTokenEstimator();
  const compressor = createTruncatingCompressor(estimator);

  it('returns the input unchanged when it already fits the budget', () => {
    const input = { text: 'short', estimatedTokens: estimator.estimate('short') };
    const result = compressor.compress(input, 100);
    expect(result).toEqual(input);
  });

  it('shrinks oversized text to fit within the budget', async () => {
    const text = 'word '.repeat(200).trim();
    const input = { text, estimatedTokens: estimator.estimate(text) };
    const result = await compressor.compress(input, 20);
    expect(result.estimatedTokens).toBeLessThanOrEqual(20);
    expect(result.text.length).toBeLessThan(text.length);
  });

  it('returns empty text for a non-positive budget', async () => {
    const input = { text: 'anything', estimatedTokens: 5 };
    const result = await compressor.compress(input, 0);
    expect(result).toEqual({ text: '', estimatedTokens: 0 });
  });
});
