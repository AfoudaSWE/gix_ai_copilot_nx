export { createModelRouter, modelKey } from './router.js';
export type {
  CreateModelRouterOptions,
  ModelCapabilities,
  ModelCatalogEntry,
  ModelRoute,
  ModelRouter,
  ModelRoutingRequest,
  PolicyRule,
  RouterStrategyConfig,
  RoutingStrategy,
} from './router.js';
export { createProviderHealth } from './health.js';
export type { CreateProviderHealthOptions, HealthOutcome, HealthSnapshot, ProviderHealth } from './health.js';
export { createRoutedModelRuntime, isFallbackEligible } from './routed-runtime.js';
export type { CreateRoutedModelRuntimeOptions, RoutingDecisionEvent } from './routed-runtime.js';
