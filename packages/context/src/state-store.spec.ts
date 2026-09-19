import { describe, expect, it, vi } from 'vitest';
import { createCopilotStateStore } from './state-store.js';

interface Filters {
  readonly status: string;
}

describe('createCopilotStateStore', () => {
  it('registers with an initial value and reads it back', () => {
    const store = createCopilotStateStore();
    const value = store.register<Filters>({ id: 'filters', name: 'filters', initialValue: { status: 'all' } });
    expect(value).toEqual({ status: 'all' });
    expect(store.get<Filters>('filters')).toEqual({ status: 'all' });
    expect(store.has('filters')).toBe(true);
  });

  it('does not reset the value when the same id is registered again', () => {
    const store = createCopilotStateStore();
    store.register<Filters>({ id: 'filters', name: 'filters', initialValue: { status: 'all' } });
    store.set<Filters>('filters', { status: 'pending' });
    const again = store.register<Filters>({ id: 'filters', name: 'filters', initialValue: { status: 'all' } });
    expect(again).toEqual({ status: 'pending' });
  });

  it('set() replaces the value and notifies subscribers', () => {
    const store = createCopilotStateStore();
    store.register<Filters>({ id: 'filters', name: 'filters', initialValue: { status: 'all' } });
    const listener = vi.fn();
    store.subscribe<Filters>('filters', listener);
    store.set('filters', { status: 'approved' });
    expect(listener).toHaveBeenCalledWith({ status: 'approved' });
    expect(store.get('filters')).toEqual({ status: 'approved' });
  });

  it('update() applies a functional updater deterministically (Section 48)', () => {
    const store = createCopilotStateStore();
    store.register<Filters>({ id: 'filters', name: 'filters', initialValue: { status: 'all' } });
    store.update<Filters>('filters', (previous) => ({ ...previous, status: 'pending' }));
    expect(store.get('filters')).toEqual({ status: 'pending' });
  });

  it('unsubscribe stops further notifications', () => {
    const store = createCopilotStateStore();
    store.register({ id: 's', name: 's', initialValue: 0 });
    const listener = vi.fn();
    const unsubscribe = store.subscribe<number>('s', listener);
    store.set('s', 1);
    unsubscribe();
    store.set('s', 2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(1);
  });

  it('validates updates and rejects invalid ones predictably (Section 49)', () => {
    const store = createCopilotStateStore();
    store.register<Filters>({
      id: 'filters',
      name: 'filters',
      initialValue: { status: 'all' },
      validate: (value) => (value.status.length > 0 ? true : { valid: false, error: 'status required' }),
    });
    expect(() => store.set('filters', { status: '' })).toThrow('status required');
    expect(store.get('filters')).toEqual({ status: 'all' }); // unchanged on rejection
    store.set('filters', { status: 'ok' });
    expect(store.get('filters')).toEqual({ status: 'ok' });
  });

  it('throws for get/set/update/subscribe on an unregistered id', () => {
    const store = createCopilotStateStore();
    expect(() => store.set('missing', 1)).toThrow();
    expect(() => store.update('missing', (v) => v)).toThrow();
    expect(() => store.subscribe('missing', () => {})).toThrow();
    expect(store.get('missing')).toBeUndefined();
  });

  it('remove() clears the slot; list() reflects current ids', () => {
    const store = createCopilotStateStore();
    store.register({ id: 'a', name: 'a', initialValue: 1 });
    store.register({ id: 'b', name: 'b', initialValue: 2 });
    expect([...store.list()].sort()).toEqual(['a', 'b']);
    store.remove('a');
    expect(store.has('a')).toBe(false);
    expect(store.list()).toEqual(['b']);
  });

  it('supports multiple independent stores with no shared state', () => {
    const a = createCopilotStateStore();
    const b = createCopilotStateStore();
    a.register({ id: 's', name: 's', initialValue: 'a-only' });
    expect(b.has('s')).toBe(false);
  });
});
