import { describe, expect, it } from 'vitest';
import { toProgressSteps } from './progress.js';
import type { ToolActivityLike } from './progress.js';

describe('toProgressSteps', () => {
  it('maps tool-call lifecycle statuses to progress statuses (Section 51)', () => {
    const activity: readonly ToolActivityLike[] = [
      { id: '1', name: 'applications.get', status: 'requested' },
      { id: '2', name: 'documents.check', status: 'running' },
      { id: '3', name: 'payment.check', status: 'succeeded' },
      { id: '4', name: 'audit.run', status: 'failed' },
    ];
    expect(toProgressSteps(activity)).toEqual([
      { id: '1', label: 'applications.get', status: 'pending' },
      { id: '2', label: 'documents.check', status: 'running' },
      { id: '3', label: 'payment.check', status: 'completed' },
      { id: '4', label: 'audit.run', status: 'failed' },
    ]);
  });

  it('preserves order and supports a custom label mapper', () => {
    const activity: readonly ToolActivityLike[] = [
      { id: '1', name: 'applications.get', status: 'succeeded' },
    ];
    const steps = toProgressSteps(activity, { labelOf: (entry) => `Loaded ${entry.name}` });
    expect(steps).toEqual([{ id: '1', label: 'Loaded applications.get', status: 'completed' }]);
  });

  it('returns an empty list for no activity', () => {
    expect(toProgressSteps([])).toEqual([]);
  });
});
