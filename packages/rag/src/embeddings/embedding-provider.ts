/**
 * Provider-neutral embedding contract (Section 34). Implementations live in this package
 * (deterministic test adapter) or are constructed here against a real provider SDK (OpenAI) -
 * never a hard dependency baked into consumers.
 */
export interface EmbeddingProvider {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  embedDocuments(texts: readonly string[], options?: { readonly signal?: AbortSignal }): Promise<number[][]>;
  embedQuery(text: string, options?: { readonly signal?: AbortSignal }): Promise<number[]>;
}
