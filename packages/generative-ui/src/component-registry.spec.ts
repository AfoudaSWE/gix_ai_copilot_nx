import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createGenerativeComponentRegistry } from './component-registry.js';

function card() {
  return {
    name: 'ApplicationCard',
    description: 'Displays a compact summary of one application.',
    propsSchema: z.object({ applicationId: z.string() }),
  };
}

describe('createGenerativeComponentRegistry', () => {
  it('registers, gets, and lists a component', () => {
    const registry = createGenerativeComponentRegistry();
    registry.register(card());
    expect(registry.has('ApplicationCard')).toBe(true);
    expect(registry.get('ApplicationCard')?.description).toContain('summary');
    expect(registry.list()).toHaveLength(1);
  });

  it('rejects a blank component name', () => {
    const registry = createGenerativeComponentRegistry();
    expect(() => registry.register({ ...card(), name: '  ' })).toThrow();
  });

  it('rejects a duplicate name by default, and update()/dispose() work on the handle', () => {
    const registry = createGenerativeComponentRegistry();
    const registration = registry.register(card());
    expect(() => registry.register(card())).toThrow();

    registration.update({ ...card(), description: 'Updated description.' });
    expect(registry.get('ApplicationCard')?.description).toBe('Updated description.');

    registration.dispose();
    expect(registry.has('ApplicationCard')).toBe(false);
    registration.dispose(); // idempotent
  });

  it('allows an intentional replace', () => {
    const registry = createGenerativeComponentRegistry();
    registry.register(card());
    expect(() => registry.register({ ...card(), description: 'v2' }, { replace: true })).not.toThrow();
    expect(registry.get('ApplicationCard')?.description).toBe('v2');
  });

  it('filters by category and tags', () => {
    const registry = createGenerativeComponentRegistry();
    registry.register({ ...card(), metadata: { category: 'applications', tags: ['card'] } });
    registry.register({
      ...card(),
      name: 'ApplicationTable',
      metadata: { category: 'applications', tags: ['table'] },
    });
    expect(registry.list({ category: 'applications' })).toHaveLength(2);
    expect(registry.list({ tags: ['card'] })).toHaveLength(1);
  });

  it('notifies subscribers on register/update/unregister, and unsubscribe stops notifications', () => {
    const registry = createGenerativeComponentRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    const registration = registry.register(card());
    expect(listener).toHaveBeenCalledTimes(1);
    registration.update({ ...card(), description: 'v2' });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    registration.dispose();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('clear() removes every component', () => {
    const registry = createGenerativeComponentRegistry();
    registry.register(card());
    registry.register({ ...card(), name: 'ApplicationTable' });
    registry.clear();
    expect(registry.list()).toHaveLength(0);
  });

  it('supports multiple independent registries', () => {
    const a = createGenerativeComponentRegistry();
    const b = createGenerativeComponentRegistry();
    a.register(card());
    expect(a.list()).toHaveLength(1);
    expect(b.list()).toHaveLength(0);
  });
});
