import { describe, expect, it } from 'vitest';
import { createContextEngine } from './context-engine.js';
import { createContextRegistry } from './context-registry.js';
import type { ContextSerializer } from './context-serializer.js';

describe('createContextEngine', () => {
  it('resolves enabled items into formatted, budgeted content', async () => {
    const registry = createContextRegistry();
    registry.register({
      name: 'selectedApplication',
      description: 'Application currently selected by the user',
      scope: 'component',
      priority: 'high',
      value: { id: 'APP-1024', status: 'pending' },
    });
    const engine = createContextEngine();
    const resolved = await engine.resolve(registry);

    expect(resolved.items).toHaveLength(1);
    expect(resolved.items[0]?.name).toBe('selectedApplication');
    expect(resolved.content).toContain('[Context: selectedApplication]');
    expect(resolved.content).toContain('Scope: component');
    expect(resolved.content).toContain('APP-1024');
    expect(resolved.estimatedTokens).toBeGreaterThan(0);
    expect(resolved.excluded).toEqual([]);
    expect(resolved.diagnostics.itemsRegistered).toBe(1);
    expect(resolved.diagnostics.itemsIncluded).toBe(1);
  });

  it('excludes disabled items and reports the reason', async () => {
    const registry = createContextRegistry();
    const registration = registry.register({ name: 'off', scope: 'page', value: 1, enabled: false });
    const engine = createContextEngine();
    const resolved = await engine.resolve(registry);
    expect(resolved.items).toHaveLength(0);
    expect(resolved.excluded).toEqual([
      { id: registration.id, name: 'off', scope: 'page', reason: 'disabled' },
    ]);
  });

  it('excludes restricted items by the default sensitivity policy', async () => {
    const registry = createContextRegistry();
    registry.register({ name: 'secret', scope: 'user', value: 'ssn', sensitivity: 'restricted' });
    const engine = createContextEngine();
    const resolved = await engine.resolve(registry);
    expect(resolved.items).toHaveLength(0);
    expect(resolved.excluded[0]?.reason).toBe('sensitivity-policy');
  });

  it('allows a custom sensitivity policy override', async () => {
    const registry = createContextRegistry();
    registry.register({ name: 'secret', scope: 'user', value: 'ok', sensitivity: 'restricted' });
    const engine = createContextEngine({ sensitivityPolicy: () => true });
    const resolved = await engine.resolve(registry);
    expect(resolved.items).toHaveLength(1);
  });

  it('isolates a broken item: one serialization failure excludes only that item (Section 61)', async () => {
    const registry = createContextRegistry();
    registry.register({ name: 'good', scope: 'page', value: { ok: true } });
    const bad = registry.register({ name: 'bad', scope: 'page', value: 'boom' });
    const throwingSerializer: ContextSerializer = {
      serialize(value: unknown) {
        if (value === 'boom') throw new Error('cannot serialize');
        return { text: JSON.stringify(value), truncated: false, warnings: [] };
      },
    };
    const engine = createContextEngine({ serializer: throwingSerializer });
    const resolved = await engine.resolve(registry);
    expect(resolved.items).toHaveLength(1);
    expect(resolved.items[0]?.name).toBe('good');
    expect(resolved.excluded).toEqual([
      { id: bad.id, name: 'bad', scope: 'page', reason: 'serialization-failure', detail: 'cannot serialize' },
    ]);
  });

  it('deduplicates identical serialized values, keeping the higher-priority item (Section 24)', async () => {
    const registry = createContextRegistry();
    const pageEntity = registry.register({
      name: 'page-entity',
      scope: 'page',
      priority: 'normal',
      value: { id: 'APP-1' },
    });
    registry.register({ name: 'selected-entity', scope: 'component', priority: 'high', value: { id: 'APP-1' } });
    const engine = createContextEngine();
    const resolved = await engine.resolve(registry);
    expect(resolved.items).toHaveLength(1);
    expect(resolved.items[0]?.name).toBe('selected-entity');
    expect(resolved.excluded).toEqual([
      { id: pageEntity.id, name: 'page-entity', scope: 'page', reason: 'duplicate' },
    ]);
  });

  it('does not merge items with different values, even with the same name', async () => {
    const registry = createContextRegistry();
    registry.register({ name: 'x', scope: 'page', value: 1 });
    registry.register({ name: 'x', scope: 'page', value: 2 });
    const engine = createContextEngine();
    const resolved = await engine.resolve(registry);
    expect(resolved.items).toHaveLength(2);
  });

  it('orders included items by priority: critical, high, normal, low', async () => {
    const registry = createContextRegistry();
    registry.register({ name: 'low', scope: 'page', priority: 'low', value: 'l' });
    registry.register({ name: 'critical', scope: 'page', priority: 'critical', value: 'c' });
    registry.register({ name: 'normal', scope: 'page', priority: 'normal', value: 'n' });
    registry.register({ name: 'high', scope: 'page', priority: 'high', value: 'h' });
    const engine = createContextEngine();
    const resolved = await engine.resolve(registry);
    expect(resolved.items.map((item) => item.name)).toEqual(['critical', 'high', 'normal', 'low']);
  });

  it('enforces the token budget: high priority included, low priority excluded for budget (Section 75)', async () => {
    const registry = createContextRegistry();
    registry.register({ name: 'critical', scope: 'page', priority: 'critical', value: 'c'.repeat(40) });
    registry.register({ name: 'high', scope: 'page', priority: 'high', value: 'h'.repeat(40) });
    registry.register({ name: 'low', scope: 'page', priority: 'low', value: 'l'.repeat(4000) });
    const engine = createContextEngine({ maxContextTokens: 40 });
    const resolved = await engine.resolve(registry);

    const includedNames = resolved.items.map((item) => item.name);
    expect(includedNames).toContain('critical');
    const lowExclusion = resolved.excluded.find((exclusion) => exclusion.name === 'low');
    expect(lowExclusion?.reason).toBe('budget');
    expect(resolved.estimatedTokens).toBeLessThanOrEqual(40 + 5); // separators add a little
  });

  it('compresses an item that nearly fits instead of excluding it outright', async () => {
    const registry = createContextRegistry();
    registry.register({ name: 'big', scope: 'page', priority: 'critical', value: 'x'.repeat(2000) });
    const engine = createContextEngine({ maxContextTokens: 50 });
    const resolved = await engine.resolve(registry);
    expect(resolved.items).toHaveLength(1);
    expect(resolved.items[0]?.truncated).toBe(true);
    expect(resolved.excluded).toEqual([]);
  });

  it('inspect() returns a debug-friendly projection of resolve()', async () => {
    const registry = createContextRegistry();
    registry.register({ name: 'a', scope: 'page', priority: 'high', value: 1 });
    registry.register({ name: 'b', scope: 'page', priority: 'low', value: 2, enabled: false });
    const engine = createContextEngine();
    const inspection = await engine.inspect(registry);
    expect(inspection.included).toHaveLength(1);
    expect(inspection.included[0]).toMatchObject({ name: 'a', scope: 'page', priority: 'high', truncated: false });
    expect(inspection.included[0]?.estimatedTokens).toBeGreaterThan(0);
    expect(inspection.excluded).toEqual([{ name: 'b', scope: 'page', reason: 'disabled' }]);
    expect(inspection.diagnostics.itemsRegistered).toBe(2);
  });

  it('produces empty content and zero tokens when nothing is registered', async () => {
    const registry = createContextRegistry();
    const engine = createContextEngine();
    const resolved = await engine.resolve(registry);
    expect(resolved.content).toBe('');
    expect(resolved.estimatedTokens).toBe(0);
  });
});
