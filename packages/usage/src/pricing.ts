/**
 * Configurable model pricing (Section 71). The SDK ships NO prices: rates change, differ by
 * contract and region, and must come from your configuration. Every estimate records which
 * pricing version produced it.
 */
export interface ModelPrice {
  /** Price per 1,000,000 input tokens, in the table's currency. */
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
}

export interface PricingTable {
  readonly version: string;
  readonly currency: string;
  /** Keyed by `provider/model`. */
  readonly models: Readonly<Record<string, ModelPrice>>;
  /** Optional flat prices per tool call or RAG query, keyed by tool name / `rag`. */
  readonly perCall?: Readonly<Record<string, number>>;
}

/** Estimated cost in micros (millionths of the currency unit), or `undefined` when unpriced. */
export function estimateCostMicros(
  pricing: PricingTable | undefined,
  usage: { readonly provider?: string; readonly model?: string; readonly inputTokens: number; readonly outputTokens: number; readonly tool?: string; readonly kind?: string; readonly count?: number },
): number | undefined {
  if (!pricing) return undefined;
  if (usage.provider && usage.model) {
    const price = pricing.models[`${usage.provider}/${usage.model}`];
    if (!price) return undefined;
    return Math.round(usage.inputTokens * price.inputPerMillion + usage.outputTokens * price.outputPerMillion);
  }
  const flat = usage.tool ? pricing.perCall?.[usage.tool] : usage.kind === 'rag_query' ? pricing.perCall?.['rag'] : undefined;
  return flat === undefined ? undefined : Math.round(flat * 1_000_000 * (usage.count ?? 1));
}

export function formatMicros(micros: number, currency: string): string {
  return `${(micros / 1_000_000).toFixed(4)} ${currency} (estimated)`;
}
