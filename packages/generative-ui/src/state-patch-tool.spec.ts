import { describe, expect, it } from 'vitest';
import { createCopilotStateStore } from '@gixcopilot/context';
import { isStatePatchToolName, statePatchToolName, toStatePatchToolDefinition } from './state-patch-tool.js';

interface Filters {
  readonly status: string;
}

function writableStore() {
  const store = createCopilotStateStore();
  store.register<Filters>({
    id: 'filters',
    name: 'applicationFilters',
    initialValue: { status: 'all' },
    modelWritable: true,
  });
  return store;
}

const execContext = { runId: 'run-1', signal: new AbortController().signal };

describe('statePatchToolName / isStatePatchToolName', () => {
  it('derives a namespaced reserved tool name from a state id', () => {
    expect(statePatchToolName('filters')).toBe('state.patch.filters');
    expect(isStatePatchToolName('state.patch.filters')).toBe(true);
    expect(isStatePatchToolName('applications.getStatus')).toBe(false);
  });
});

describe('toStatePatchToolDefinition', () => {
  it('applies a valid "set" patch and returns the new revision/value', async () => {
    const store = writableStore();
    const tool = toStatePatchToolDefinition(store, 'filters', {
      name: 'applicationFilters',
      description: 'Update the applications filter.',
    });
    const result = await tool.execute(
      { op: 'set', value: { status: 'pending' }, baseRevision: 0 },
      execContext,
    );
    expect(result).toEqual({ status: 'applied', revision: 1, value: { status: 'pending' } });
    expect(store.get('filters')).toEqual({ status: 'pending' });
  });

  it('returns a structured conflict result (not a thrown error) for a stale baseRevision', async () => {
    const store = writableStore();
    store.set('filters', { status: 'approved' }); // moves the UI to revision 1
    const tool = toStatePatchToolDefinition(store, 'filters', {
      name: 'applicationFilters',
      description: 'Update the applications filter.',
    });
    const result = await tool.execute(
      { op: 'set', value: { status: 'pending' }, baseRevision: 0 },
      execContext,
    );
    expect(result).toEqual({ status: 'conflict', currentRevision: 1 });
    expect(store.get('filters')).toEqual({ status: 'approved' });
  });

  it('returns a structured rejection for a non-writable state id', async () => {
    const store = createCopilotStateStore();
    store.register<Filters>({ id: 'filters', name: 'applicationFilters', initialValue: { status: 'all' } });
    const tool = toStatePatchToolDefinition(store, 'filters', {
      name: 'applicationFilters',
      description: 'Update the applications filter.',
    });
    const result = await tool.execute(
      { op: 'set', value: { status: 'pending' }, baseRevision: 0 },
      execContext,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'not-writable' });
  });

  it('builds a client-executed, non-read-only tool', () => {
    const store = writableStore();
    const tool = toStatePatchToolDefinition(store, 'filters', {
      name: 'applicationFilters',
      description: 'Update the applications filter.',
    });
    expect(tool.name).toBe('state.patch.filters');
    expect(tool.metadata?.executionLocation).toBe('client');
    expect(tool.metadata?.readOnly).toBe(false);
  });
});
