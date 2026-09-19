/**
 * A provider-neutral abstraction over "how many tokens will this text cost" (Section 26).
 * The context package must not couple itself to any one provider's tokenizer - a host
 * application can supply a more accurate estimator (e.g. backed by a real tokenizer) via
 * `ContextEngineOptions.estimator`; the default below is a documented approximation only.
 */
export interface TokenEstimator {
  estimate(text: string): number;
}

/**
 * A simple, dependency-free heuristic (~4 characters per token, English-text average),
 * rounded up. This is intentionally approximate - see Section 26 - and good enough for
 * deterministic budgeting decisions; it is not a substitute for a real tokenizer when
 * precise accounting matters.
 */
export function createDefaultTokenEstimator(): TokenEstimator {
  return {
    estimate(text: string): number {
      if (!text) return 0;
      return Math.max(1, Math.ceil(text.length / 4));
    },
  };
}
