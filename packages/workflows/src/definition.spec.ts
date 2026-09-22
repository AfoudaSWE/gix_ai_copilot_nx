import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineWorkflow } from './definition.js';
import { functionStep, parallelStep } from './steps.js';

const countState = z.object({ count: z.number() });
type CountState = z.infer<typeof countState>;
const emptyState = z.object({});
type EmptyState = z.infer<typeof emptyState>;

describe('defineWorkflow / validateWorkflowGraph', () => {
  it('accepts a valid sequential workflow', () => {
    const workflow = defineWorkflow({
      id: 'seq',
      version: '1',
      state: countState,
      initialState: () => ({ count: 0 }),
      steps: [
        functionStep<CountState>({ id: 's1', run: ({ state }) => ({ count: state.count + 1 }) }),
        functionStep<CountState>({ id: 's2', dependencies: ['s1'], run: ({ state }) => ({ count: state.count + 1 }) }),
      ],
    });
    expect(workflow.steps).toHaveLength(2);
  });

  it('rejects duplicate step ids', () => {
    expect(() =>
      defineWorkflow({
        id: 'dup',
        version: '1',
        state: emptyState,
        initialState: () => ({}),
        steps: [
          functionStep<EmptyState>({ id: 's1', run: ({ state }) => state }),
          functionStep<EmptyState>({ id: 's1', run: ({ state }) => state }),
        ],
      }),
    ).toThrow(/WORKFLOW_DEFINITION_INVALID|failed graph validation/);
  });

  it('rejects an unknown dependency', () => {
    expect(() =>
      defineWorkflow({
        id: 'baddep',
        version: '1',
        state: emptyState,
        initialState: () => ({}),
        steps: [functionStep<EmptyState>({ id: 's1', dependencies: ['ghost'], run: ({ state }) => state })],
      }),
    ).toThrow();
  });

  it('detects a dependency cycle', () => {
    expect(() =>
      defineWorkflow({
        id: 'cycle',
        version: '1',
        state: emptyState,
        initialState: () => ({}),
        steps: [
          functionStep<EmptyState>({ id: 's1', dependencies: ['s2'], run: ({ state }) => state }),
          functionStep<EmptyState>({ id: 's2', dependencies: ['s1'], run: ({ state }) => state }),
        ],
      }),
    ).toThrow();
  });

  it('rejects a parallel step referencing an unknown branch', () => {
    expect(() =>
      defineWorkflow({
        id: 'badbranch',
        version: '1',
        state: emptyState,
        initialState: () => ({}),
        steps: [parallelStep<EmptyState>({ id: 'p1', branches: ['ghost'] })],
      }),
    ).toThrow();
  });

  it('rejects a branch step that also declares its own top-level dependencies', () => {
    expect(() =>
      defineWorkflow({
        id: 'badbranchdeps',
        version: '1',
        state: emptyState,
        initialState: () => ({}),
        steps: [
          functionStep<EmptyState>({ id: 'pre', run: ({ state }) => state }),
          functionStep<EmptyState>({ id: 'branch-a', dependencies: ['pre'], run: ({ state }) => state }),
          parallelStep<EmptyState>({ id: 'p1', branches: ['branch-a'] }),
        ],
      }),
    ).toThrow();
  });
});
