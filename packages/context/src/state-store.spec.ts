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

  describe('revision and modelWritable (Phase 6)', () => {
    it('starts at revision 0 and increments on set/update', () => {
      const store = createCopilotStateStore();
      store.register({ id: 's', name: 's', initialValue: 1 });
      expect(store.getRevision('s')).toBe(0);
      store.set('s', 2);
      expect(store.getRevision('s')).toBe(1);
      store.update('s', (previous: number) => previous + 1);
      expect(store.getRevision('s')).toBe(2);
    });

    it('defaults to not model-writable', () => {
      const store = createCopilotStateStore();
      store.register({ id: 's', name: 's', initialValue: 1 });
      expect(store.isModelWritable('s')).toBe(false);
    });

    it('registering again refreshes modelWritable from the latest definition', () => {
      const store = createCopilotStateStore();
      store.register({ id: 's', name: 's', initialValue: 1, modelWritable: true });
      expect(store.isModelWritable('s')).toBe(true);
    });
  });

  describe('applyPatch (Section 43-46)', () => {
    function writableStore() {
      const store = createCopilotStateStore();
      store.register<Filters>({
        id: 'filters',
        name: 'filters',
        initialValue: { status: 'all' },
        modelWritable: true,
      });
      return store;
    }

    it('rejects a patch for an unknown state id', () => {
      const store = createCopilotStateStore();
      expect(store.applyPatch('missing', { op: 'set', value: 1 }, 0)).toEqual({
        status: 'rejected',
        reason: 'unknown-state',
      });
    });

    it('rejects a patch for a non-writable state id, leaving the value unchanged', () => {
      const store = createCopilotStateStore();
      store.register<Filters>({ id: 'filters', name: 'filters', initialValue: { status: 'all' } });
      const result = store.applyPatch('filters', { op: 'set', value: { status: 'pending' } }, 0);
      expect(result).toEqual({ status: 'rejected', reason: 'not-writable' });
      expect(store.get('filters')).toEqual({ status: 'all' });
    });

    it('applies a "set" patch and increments revision', () => {
      const store = writableStore();
      const result = store.applyPatch('filters', { op: 'set', value: { status: 'pending' } }, 0);
      expect(result).toEqual({ status: 'applied', revision: 1, value: { status: 'pending' } });
      expect(store.get('filters')).toEqual({ status: 'pending' });
      expect(store.getRevision('filters')).toBe(1);
    });

    it('applies a "merge" patch by shallow-merging into the current object value', () => {
      const store = createCopilotStateStore();
      store.register<{ status: string; country: string }>({
        id: 'filters',
        name: 'filters',
        initialValue: { status: 'all', country: 'AE' },
        modelWritable: true,
      });
      const result = store.applyPatch('filters', { op: 'merge', value: { status: 'pending' } }, 0);
      expect(result).toEqual({
        status: 'applied',
        revision: 1,
        value: { status: 'pending', country: 'AE' },
      });
    });

    it('rejects a "merge" patch against a non-object value', () => {
      const store = createCopilotStateStore();
      store.register<number>({ id: 'n', name: 'n', initialValue: 1, modelWritable: true });
      const result = store.applyPatch('n', { op: 'merge', value: { x: 1 } }, 0);
      expect(result.status).toBe('rejected');
      expect(result.status === 'rejected' && result.reason).toBe('invalid-patch');
      expect(store.get('n')).toBe(1);
    });

    it('detects a stale baseRevision as a conflict, leaving the value unchanged (Section 45-46)', () => {
      const store = writableStore();
      store.set('filters', { status: 'approved' }); // UI moves the value to revision 1
      const result = store.applyPatch('filters', { op: 'set', value: { status: 'pending' } }, 0);
      expect(result).toEqual({ status: 'conflict', currentRevision: 1 });
      expect(store.get('filters')).toEqual({ status: 'approved' }); // never overwritten
    });

    it('rejects a patch whose result fails the registered validator, without mutating state', () => {
      const store = createCopilotStateStore();
      store.register<Filters>({
        id: 'filters',
        name: 'filters',
        initialValue: { status: 'all' },
        modelWritable: true,
        validate: (value) => (value.status.length > 0 ? true : { valid: false, error: 'status required' }),
      });
      const result = store.applyPatch('filters', { op: 'set', value: { status: '' } }, 0);
      expect(result).toEqual({ status: 'rejected', reason: 'invalid-value', detail: 'status required' });
      expect(store.get('filters')).toEqual({ status: 'all' });
    });

    it('notifies subscribers only when a patch is actually applied', () => {
      const store = writableStore();
      const listener = vi.fn();
      store.subscribe('filters', listener);
      store.applyPatch('filters', { op: 'set', value: { status: 'pending' } }, 5); // stale, rejected
      expect(listener).not.toHaveBeenCalled();
      store.applyPatch('filters', { op: 'set', value: { status: 'pending' } }, 0); // correct baseRevision
      expect(listener).toHaveBeenCalledWith({ status: 'pending' });
    });
  });
});
