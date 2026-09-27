import { CopilotError } from '@gixcopilot/protocol';
import type { ModelReference } from '@gixcopilot/provider';
import type { ProviderHealth } from './health.js';

/** Provider-neutral capability metadata, declared per model from what its adapter supports. */
export interface ModelCapabilities {
  readonly streaming: boolean;
  readonly tools: boolean;
  readonly structuredOutput: boolean;
  readonly vision: boolean;
  /** Context window in tokens. */
  readonly contextWindow: number;
}

export interface ModelCatalogEntry extends ModelReference {
  readonly capabilities: ModelCapabilities;
  /** Relative cost tier for policies such as "route cheaper"; prices live in usage pricing. */
  readonly tier?: 'economy' | 'standard' | 'premium';
  readonly enabled?: boolean;
}

export interface ModelRoutingRequest {
  /** A model the caller asked for (honored only if the catalog allows it). */
  readonly requested?: ModelReference;
  readonly tenantId?: string;
  readonly projectId?: string;
  readonly environment?: string;
  readonly taskType?: string;
  readonly requires?: Partial<Pick<ModelCapabilities, 'tools' | 'structuredOutput' | 'vision' | 'streaming'>>;
  readonly minContextWindow?: number;
  /** Set by an explicit budget policy (never implicitly). */
  readonly preferTier?: ModelCatalogEntry['tier'];
}

export type RoutingStrategy = 'fixed' | 'fallback' | 'capability' | 'policy';

export interface ModelRoute {
  readonly primary: ModelReference;
  /** Tried in order only for fallback-eligible failures that happen before any output. */
  readonly fallbacks: readonly ModelReference[];
  readonly strategy: RoutingStrategy;
  /** Human-readable, deterministic explanation (recorded in telemetry/DevTools). */
  readonly reason: string;
}

export interface ModelRouter {
  select(request: ModelRoutingRequest): Promise<ModelRoute>;
}

export interface PolicyRule {
  readonly when: Partial<Pick<ModelRoutingRequest, 'tenantId' | 'projectId' | 'environment' | 'taskType'>>;
  readonly models: readonly ModelReference[];
}

export type RouterStrategyConfig =
  | { readonly type: 'fixed'; readonly model: ModelReference }
  | { readonly type: 'fallback'; readonly chain: readonly ModelReference[] }
  /** Catalog order is preference order; models lacking a required capability are skipped. */
  | { readonly type: 'capability'; readonly order?: readonly ModelReference[] }
  | { readonly type: 'policy'; readonly rules: readonly PolicyRule[]; readonly default: readonly ModelReference[] };

export interface CreateModelRouterOptions {
  readonly catalog: readonly ModelCatalogEntry[];
  readonly strategy: RouterStrategyConfig;
  /** When set, unhealthy models move behind healthy ones (never removed entirely). */
  readonly health?: ProviderHealth;
  /** Honor `request.requested` when it is in the catalog and capable (default true). */
  readonly allowRequestedModel?: boolean;
}

export const modelKey = (model: ModelReference): string => `${model.provider}/${model.model}`;

function capable(entry: ModelCatalogEntry, request: ModelRoutingRequest): boolean {
  if (entry.enabled === false) return false;
  const needs = request.requires ?? {};
  for (const key of ['tools', 'structuredOutput', 'vision', 'streaming'] as const) {
    if (needs[key] && !entry.capabilities[key]) return false;
  }
  return request.minContextWindow === undefined || entry.capabilities.contextWindow >= request.minContextWindow;
}

function matches(rule: PolicyRule, request: ModelRoutingRequest): boolean {
  return Object.entries(rule.when).every(([key, value]) => request[key as keyof ModelRoutingRequest] === value);
}

/**
 * Deterministic model routing (Section 61-63): the same configuration, request and health
 * state always give the same route, with a reason. No opaque scoring.
 */
export function createModelRouter(options: CreateModelRouterOptions): ModelRouter {
  const catalog = new Map(options.catalog.map((entry) => [modelKey(entry), entry]));
  const lookup = (model: ModelReference): ModelCatalogEntry | undefined => catalog.get(modelKey(model));

  function candidates(request: ModelRoutingRequest): { models: ModelReference[]; strategy: RoutingStrategy; reason: string } {
    const strategy = options.strategy;
    switch (strategy.type) {
      case 'fixed':
        return { models: [strategy.model], strategy: 'fixed', reason: `fixed model ${modelKey(strategy.model)}` };
      case 'fallback':
        return { models: [...strategy.chain], strategy: 'fallback', reason: 'configured fallback chain' };
      case 'capability': {
        const order = strategy.order ? strategy.order.map((model) => lookup(model)).filter((entry) => entry !== undefined) : [...catalog.values()];
        return { models: order, strategy: 'capability', reason: 'catalog order filtered by required capabilities' };
      }
      case 'policy': {
        const rule = strategy.rules.find((candidate) => matches(candidate, request));
        return rule
          ? { models: [...rule.models], strategy: 'policy', reason: `policy rule ${JSON.stringify(rule.when)}` }
          : { models: [...strategy.default], strategy: 'policy', reason: 'policy default' };
      }
    }
  }

  return {
    select(request) {
      const base = candidates(request);
      let models = base.models;
      let reason = base.reason;
      const requested = request.requested ? lookup(request.requested) : undefined;
      if (requested && (options.allowRequestedModel ?? true) && capable(requested, request)) {
        models = [requested, ...models.filter((model) => modelKey(model) !== modelKey(requested))];
        reason = `requested model ${modelKey(requested)}; then ${reason}`;
      }
      const usable = models.filter((model) => {
        const entry = lookup(model);
        return entry !== undefined && capable(entry, request);
      });
      if (request.preferTier) {
        const preferred = usable.filter((model) => lookup(model)?.tier === request.preferTier);
        if (preferred.length > 0) {
          const rest = usable.filter((model) => !preferred.includes(model));
          usable.splice(0, usable.length, ...preferred, ...rest);
          reason = `${reason}; preferred tier ${request.preferTier} (explicit policy)`;
        }
      }
      if (usable.length === 0) {
        return Promise.reject(CopilotError.modelNotFound('No configured model satisfies this request.', { strategy: base.strategy }));
      }
      const health = options.health;
      const ordered = health ? [...usable.filter((model) => health.isAvailable(model)), ...usable.filter((model) => !health.isAvailable(model))] : usable;
      if (health && modelKey(ordered[0] ?? usable[0] as ModelReference) !== modelKey(usable[0] as ModelReference)) {
        reason = `${reason}; ${modelKey(usable[0] as ModelReference)} deprioritized (unhealthy)`;
      }
      const [primary, ...fallbacks] = ordered;
      if (!primary) return Promise.reject(CopilotError.modelNotFound('No configured model satisfies this request.'));
      return Promise.resolve({
        primary: { provider: primary.provider, model: primary.model },
        fallbacks: fallbacks.map((model) => ({ provider: model.provider, model: model.model })),
        strategy: base.strategy,
        reason,
      });
    },
  };
}
