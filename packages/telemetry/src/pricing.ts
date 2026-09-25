import type { Usage } from '@gixcopilot/protocol';

/** Per-million-token prices (Section 18). Never hard-coded as authoritative core behavior -
 * the host supplies a `PricingProvider`; `createStaticPricingTable` is only a convenience. */
export interface ModelPricing {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly cachedInputPerMillion?: number;
  readonly currency?: string;
  /** Free-form provenance, e.g. "vendor price list 2026-09" - surfaced in reports. */
  readonly source?: string;
}

export type PricingProvider = (provider: string | undefined, model: string | undefined) => ModelPricing | undefined;

export interface CostEstimate {
  /** Always an estimate (Section 119) - labeled as such wherever it is displayed. */
  readonly estimate: true;
  readonly amount: number;
  readonly currency: string;
  readonly pricing: ModelPricing;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface CostEstimator {
  estimate(usage: Usage | undefined, model: { readonly provider?: string; readonly model?: string }): CostEstimate | undefined;
}

export function createStaticPricingTable(table: Readonly<Record<string, ModelPricing>>): PricingProvider {
  return (provider, model) => {
    if (!model) return undefined;
    return table[`${provider ?? '*'}/${model}`] ?? table[`*/${model}`] ?? table[model];
  };
}

export function createCostEstimator(options: { readonly pricing: PricingProvider }): CostEstimator {
  return {
    estimate(usage, model) {
      if (!usage) return undefined;
      const pricing = options.pricing(model.provider, model.model);
      if (!pricing) return undefined;
      const amount =
        (usage.inputTokens / 1_000_000) * pricing.inputPerMillion +
        (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
      return {
        estimate: true,
        amount,
        currency: pricing.currency ?? 'USD',
        pricing,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      };
    },
  };
}
