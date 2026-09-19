import type { TokenEstimator } from './token-estimator.js';
import { createDefaultTokenEstimator } from './token-estimator.js';

/** The minimal shape a compressor operates on - already-serialized text plus its cost. */
export interface CompressibleText {
  readonly text: string;
  readonly estimatedTokens: number;
}

/**
 * The compression extension point (Section 29). Phase 4 ships only a deterministic
 * truncating implementation (`createTruncatingCompressor`); the interface is async-capable
 * so a future phase can plug in an LLM-based summarizer for a single over-budget item
 * without changing `ContextEngine`'s pipeline.
 *
 * Deliberately narrower than a whole-`SerializedContext` compressor: `ContextEngine`
 * (`context-engine.ts`) already performs whole-context priority/budget selection itself
 * (Section 23, 27) and only reaches for a compressor when one *individual* item's own text
 * does not fit in whatever budget remains for it - see `Phase_4_Decisions.md`.
 */
export interface ContextCompressor {
  compress(input: CompressibleText, budgetTokens: number): Promise<CompressibleText> | CompressibleText;
}

const TRUNCATION_MARKER = '\n…(truncated to fit context budget)';

/**
 * Deterministically shrinks `text` toward `budgetTokens` using the supplied (or default)
 * estimator, by iteratively resizing proportionally to the estimator's own ratio rather
 * than assuming a fixed chars-per-token constant - keeps this correct for any pluggable
 * estimator, not just the default heuristic.
 */
export function createTruncatingCompressor(estimator: TokenEstimator = createDefaultTokenEstimator()): ContextCompressor {
  return {
    compress(input: CompressibleText, budgetTokens: number): CompressibleText {
      if (budgetTokens <= 0) {
        return { text: '', estimatedTokens: 0 };
      }
      if (input.estimatedTokens <= budgetTokens) {
        return input;
      }

      let text = input.text;
      for (let attempt = 0; attempt < 6; attempt++) {
        const currentTokens = estimator.estimate(text);
        if (currentTokens <= budgetTokens) {
          return { text, estimatedTokens: currentTokens };
        }
        const ratio = Math.max(0, budgetTokens / currentTokens);
        const targetLength = Math.max(
          0,
          Math.floor(text.length * ratio) - TRUNCATION_MARKER.length,
        );
        if (targetLength <= 0) {
          return { text: '', estimatedTokens: 0 };
        }
        text = text.slice(0, targetLength) + TRUNCATION_MARKER;
      }
      return { text, estimatedTokens: estimator.estimate(text) };
    },
  };
}
