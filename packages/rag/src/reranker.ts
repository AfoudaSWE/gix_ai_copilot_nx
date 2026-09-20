import type { RetrievalItem } from './retriever.js';

/**
 * Optional post-ACL-filter reranking stage (Section 67/68). Never a substitute for the ACL
 * filter (the rag skill's explicit rule) - a Reranker only ever reorders/re-scores items that
 * already passed authorization.
 */
export interface Reranker {
  rerank(query: string, items: readonly RetrievalItem[], options?: { readonly signal?: AbortSignal }): Promise<readonly RetrievalItem[]>;
}

/**
 * Baseline reranker (Section 68): keeps the existing similarity-score ordering. A real
 * cross-encoder/LLM/provider reranker can implement the same `Reranker` interface without any
 * change to the retrieval pipeline (Section 138) - reranking is optional, never mandatory.
 */
export function createSimilarityReranker(): Reranker {
  return {
    // eslint-disable-next-line @typescript-eslint/require-await -- Reranker is async so a real cross-encoder/LLM reranker fits the same interface
    async rerank(_query: string, items: readonly RetrievalItem[]): Promise<readonly RetrievalItem[]> {
      return [...items].sort((a, b) => b.score - a.score);
    },
  };
}
