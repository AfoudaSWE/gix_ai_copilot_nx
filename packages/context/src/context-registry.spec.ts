import { describe, expect, it, vi } from 'vitest';
import { createContextRegistry } from './context-registry.js';

describe('createContextRegistry', () => {
  it('registers with defaults, updates, and removes on dispose', () => {
    const registry = createContextRegistry();
    const registration = registry.register({
      name: 'selectedApplication',
      scope: 'component',
      value: { id: 'APP-1' },
    });

    const stored = registry.get(registration.id);
    expect(stored?.priority).toBe('normal');
    expect(stored?.sensitivity).toBe('internal');
    expect(stored?.enabled).toBe(true);

    registration.update({ id: 'APP-2' });
    expect(registry.get(registration.id)?.value).toEqual({ id: 'APP-2' });

    registration.dispose();
    expect(registry.get(registration.id)).toBeUndefined();
    registration.dispose(); // idempotent
  });

  it('treats an explicit id as an update-in-place key (Section 18)', () => {
    const registry = createContextRegistry();
    registry.register({ id: 'fixed', name: 'a', scope: 'page', value: 1 });
    registry.register({ id: 'fixed', name: 'b', scope: 'page', value: 2 });
    expect(registry.list()).toHaveLength(1);
    expect(registry.get('fixed')?.name).toBe('b');
    expect(registry.get('fixed')?.value).toBe(2);
  });

  it('creates a distinct item per call when no id is supplied, even with the same name', () => {
    const registry = createContextRegistry();
    registry.register({ name: 'dup', scope: 'page', value: 1 });
    registry.register({ name: 'dup', scope: 'page', value: 2 });
    expect(registry.list()).toHaveLength(2);
  });

  it('rejects a blank name', () => {
    const registry = createContextRegistry();
    expect(() => registry.register({ name: '  ', scope: 'page', value: 1 })).toThrow();
  });

  it('filters by scope and enabledOnly', () => {
    const registry = createContextRegistry();
    registry.register({ name: 'a', scope: 'page', value: 1 });
    registry.register({ name: 'b', scope: 'component', value: 2, enabled: false });
    expect(registry.list({ scope: 'page' })).toHaveLength(1);
    expect(registry.list({ scope: ['page', 'component'] })).toHaveLength(2);
    expect(registry.list({ enabledOnly: true })).toHaveLength(1);
  });

  it('notifies subscribers on register/update/remove, and unsubscribe stops notifications', () => {
    const registry = createContextRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    const registration = registry.register({ name: 'a', scope: 'page', value: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    registration.patch({ value: 2 });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    registration.dispose();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('patch merges fields without touching the rest', () => {
    const registry = createContextRegistry();
    const registration = registry.register({
      name: 'a',
      description: 'first',
      scope: 'page',
      value: 1,
      priority: 'low',
    });
    registration.patch({ value: 2 });
    const item = registry.get(registration.id);
    expect(item).toMatchObject({ name: 'a', description: 'first', value: 2, priority: 'low' });
  });

  it('throws when updating/patching a disposed or unknown id', () => {
    const registry = createContextRegistry();
    expect(() => registry.update('missing', 1)).toThrow();
    expect(() => registry.patch('missing', { value: 1 })).toThrow();
  });

  it('clear() removes every item and notifies once', () => {
    const registry = createContextRegistry();
    const listener = vi.fn();
    registry.register({ name: 'a', scope: 'page', value: 1 });
    registry.register({ name: 'b', scope: 'page', value: 2 });
    registry.subscribe(listener);
    registry.clear();
    expect(registry.list()).toHaveLength(0);
    expect(listener).toHaveBeenCalledTimes(1);
    registry.clear(); // no-op, no extra notification
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('supports multiple independent registries', () => {
    const a = createContextRegistry();
    const b = createContextRegistry();
    a.register({ name: 'only-a', scope: 'page', value: 1 });
    expect(a.list()).toHaveLength(1);
    expect(b.list()).toHaveLength(0);
  });
});
