import type { IntegrationHealth, IntegrationRecord, IntegrationSummary, IntegrationType } from './types.js';

export interface IntegrationListFilter {
  readonly type?: IntegrationType;
  readonly status?: IntegrationHealth;
}

/**
 * A common registry tracking OpenAPI/MCP/future-connector integrations uniformly (Section 91)
 * - deliberately minimal: registration, health updates, and lookup only. Not a management
 * platform (no persistence, no UI, no scheduling) - Section 91's explicit "do not turn this
 * into the Phase 12 management platform" boundary.
 */
export interface IntegrationRegistry {
  register(record: IntegrationRecord): void;
  unregister(id: string): void;
  has(id: string): boolean;
  get(id: string): IntegrationRecord | undefined;
  list(filter?: IntegrationListFilter): readonly IntegrationRecord[];
  /** Updates just the health/capability fields of an already-registered integration, e.g.
   * after a `refresh()` or a connection state change - avoids re-registering the whole record
   * for what is usually a small, frequent update. */
  updateStatus(id: string, status: IntegrationHealth, capabilities?: readonly string[]): void;
  summarize(): readonly IntegrationSummary[];
  subscribe(listener: () => void): () => void;
}

export function createIntegrationRegistry(): IntegrationRegistry {
  const records = new Map<string, IntegrationRecord>();
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function matches(record: IntegrationRecord, filter: IntegrationListFilter | undefined): boolean {
    if (!filter) return true;
    if (filter.type !== undefined && record.type !== filter.type) return false;
    if (filter.status !== undefined && record.status !== filter.status) return false;
    return true;
  }

  return {
    register(record) {
      records.set(record.id, record);
      notify();
    },
    unregister(id) {
      if (records.delete(id)) notify();
    },
    has: (id) => records.has(id),
    get: (id) => records.get(id),
    list: (filter) => Array.from(records.values()).filter((record) => matches(record, filter)),
    updateStatus(id, status, capabilities) {
      const existing = records.get(id);
      if (!existing) return;
      records.set(id, { ...existing, status, capabilities: capabilities ?? existing.capabilities });
      notify();
    },
    summarize: () =>
      Array.from(records.values()).map((record) => ({
        id: record.id,
        type: record.type,
        name: record.name,
        status: record.status,
        capabilityCount: record.capabilities.length,
      })),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
