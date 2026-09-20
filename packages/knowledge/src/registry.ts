import { CopilotError } from '@gixcopilot/protocol';
import type { KnowledgeSource } from './source.js';

/** Tracks configured knowledge sources (Section 11). Not a mandatory global singleton - callers create one per application/tenant as needed. */
export interface KnowledgeSourceRegistry {
  register(source: KnowledgeSource): void;
  get(id: string): KnowledgeSource | undefined;
  list(): readonly KnowledgeSource[];
  remove(id: string): void;
}

export function createKnowledgeSourceRegistry(
  initial: readonly KnowledgeSource[] = [],
): KnowledgeSourceRegistry {
  const sources = new Map<string, KnowledgeSource>();
  for (const source of initial) {
    sources.set(source.id, source);
  }

  return {
    register(source) {
      if (sources.has(source.id)) {
        throw CopilotError.validation(`A knowledge source with id "${source.id}" is already registered.`, {
          sourceId: source.id,
        });
      }
      sources.set(source.id, source);
    },
    get(id) {
      return sources.get(id);
    },
    list() {
      return [...sources.values()];
    },
    remove(id) {
      sources.delete(id);
    },
  };
}
