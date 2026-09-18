import { CopilotError } from '@gixcopilot/protocol';
import type { ModelProvider } from './model-provider.js';

/**
 * A plain, dependency-injectable registry - not a global mutable singleton (Section 16).
 * Each `createModelProviderRegistry()` call returns an independent instance, so tests never
 * leak provider registrations into each other.
 */
export interface ModelProviderRegistry {
  /** Throws if a provider with this id is already registered - see the "duplicate registration" decision in docs/adr/0006. */
  register(provider: ModelProvider): void;
  get(providerId: string): ModelProvider | undefined;
  /** Like `get`, but throws a normalized MODEL_NOT_FOUND CopilotError instead of returning undefined. */
  require(providerId: string): ModelProvider;
  list(): readonly string[];
}

export function createModelProviderRegistry(
  initial: readonly ModelProvider[] = [],
): ModelProviderRegistry {
  const providers = new Map<string, ModelProvider>();

  const registry: ModelProviderRegistry = {
    register(provider) {
      if (providers.has(provider.id)) {
        throw CopilotError.validation(
          `A provider is already registered under id "${provider.id}".`,
          {
            providerId: provider.id,
          },
        );
      }
      providers.set(provider.id, provider);
    },
    get(providerId) {
      return providers.get(providerId);
    },
    require(providerId) {
      const provider = providers.get(providerId);
      if (!provider) {
        throw CopilotError.modelNotFound(`No provider is registered under id "${providerId}".`, {
          providerId,
        });
      }
      return provider;
    },
    list() {
      return Array.from(providers.keys());
    },
  };

  for (const provider of initial) {
    registry.register(provider);
  }

  return registry;
}
