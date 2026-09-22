import { describe, expect, it } from 'vitest';
import { validatePlanStructure } from './plan.js';
import type { Plan } from './plan.js';

describe('validatePlanStructure', () => {
  it('accepts a valid, acyclic plan', () => {
    const plan: Plan = {
      id: 'p1',
      goal: 'Check and summarize an application',
      steps: [
        { id: 's1', type: 'tool', target: 'applications.get', description: 'Fetch the application' },
        { id: 's2', type: 'model', description: 'Summarize', dependencies: ['s1'] },
      ],
    };
    expect(validatePlanStructure(plan)).toEqual([]);
  });

  it('rejects duplicate step ids', () => {
    const plan: Plan = {
      id: 'p1',
      goal: 'g',
      steps: [
        { id: 's1', type: 'model', description: 'a' },
        { id: 's1', type: 'model', description: 'b' },
      ],
    };
    const errors = validatePlanStructure(plan);
    expect(errors.some((error) => error.reason === 'DUPLICATE_STEP_ID')).toBe(true);
  });

  it('rejects a dependency on an unknown step', () => {
    const plan: Plan = {
      id: 'p1',
      goal: 'g',
      steps: [{ id: 's1', type: 'model', description: 'a', dependencies: ['ghost'] }],
    };
    const errors = validatePlanStructure(plan);
    expect(errors.some((error) => error.reason === 'UNKNOWN_DEPENDENCY')).toBe(true);
  });

  it('rejects a tool/agent step with no target', () => {
    const plan: Plan = {
      id: 'p1',
      goal: 'g',
      steps: [{ id: 's1', type: 'tool', description: 'missing target' }],
    };
    const errors = validatePlanStructure(plan);
    expect(errors.some((error) => error.reason === 'MISSING_TARGET')).toBe(true);
  });

  it('detects a dependency cycle', () => {
    const plan: Plan = {
      id: 'p1',
      goal: 'g',
      steps: [
        { id: 's1', type: 'model', description: 'a', dependencies: ['s2'] },
        { id: 's2', type: 'model', description: 'b', dependencies: ['s1'] },
      ],
    };
    const errors = validatePlanStructure(plan);
    expect(errors.some((error) => error.reason === 'CYCLE_DETECTED')).toBe(true);
  });
});
