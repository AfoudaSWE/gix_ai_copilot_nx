import { describe, expect, it, vi } from 'vitest';
import { createIntegrationRegistry } from './integration-registry.js';
import type { IntegrationRecord } from './types.js';

function record(overrides: Partial<IntegrationRecord> = {}): IntegrationRecord {
  return {
    id: 'vas',
    type: 'openapi',
    name: 'VAS Master Data',
    status: 'ready',
    source: 'openapi.yaml',
    capabilities: ['applications.get', 'applications.list'],
    ...overrides,
  };
}

describe('createIntegrationRegistry', () => {
  it('registers and retrieves an integration by id', () => {
    const registry = createIntegrationRegistry();
    registry.register(record());
    expect(registry.has('vas')).toBe(true);
    expect(registry.get('vas')?.name).toBe('VAS Master Data');
  });

  it('unregister removes the integration', () => {
    const registry = createIntegrationRegistry();
    registry.register(record());
    registry.unregister('vas');
    expect(registry.has('vas')).toBe(false);
  });

  it('list filters by type and status', () => {
    const registry = createIntegrationRegistry();
    registry.register(record({ id: 'vas', type: 'openapi', status: 'ready' }));
    registry.register(record({ id: 'github', type: 'mcp', status: 'error' }));

    expect(registry.list({ type: 'mcp' }).map((r) => r.id)).toEqual(['github']);
    expect(registry.list({ status: 'ready' }).map((r) => r.id)).toEqual(['vas']);
    expect(registry.list().map((r) => r.id).sort()).toEqual(['github', 'vas']);
  });

  it('updateStatus changes status and capabilities in place', () => {
    const registry = createIntegrationRegistry();
    registry.register(record({ status: 'ready', capabilities: ['a'] }));
    registry.updateStatus('vas', 'degraded', ['a', 'b']);
    expect(registry.get('vas')?.status).toBe('degraded');
    expect(registry.get('vas')?.capabilities).toEqual(['a', 'b']);
  });

  it('updateStatus without new capabilities preserves the existing list', () => {
    const registry = createIntegrationRegistry();
    registry.register(record({ capabilities: ['a', 'b'] }));
    registry.updateStatus('vas', 'error');
    expect(registry.get('vas')?.capabilities).toEqual(['a', 'b']);
  });

  it('updateStatus on an unknown id is a no-op', () => {
    const registry = createIntegrationRegistry();
    expect(() => registry.updateStatus('missing', 'error')).not.toThrow();
  });

  it('summarize returns a lightweight view with capability counts', () => {
    const registry = createIntegrationRegistry();
    registry.register(record({ capabilities: ['a', 'b', 'c'] }));
    expect(registry.summarize()).toEqual([
      { id: 'vas', type: 'openapi', name: 'VAS Master Data', status: 'ready', capabilityCount: 3 },
    ]);
  });

  it('notifies subscribers on register/unregister/updateStatus', () => {
    const registry = createIntegrationRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);

    registry.register(record());
    registry.updateStatus('vas', 'error');
    registry.unregister('vas');
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    registry.register(record());
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
