import { describe, expect, it } from 'vitest';
import { createModelRuntime } from '@gixcopilot/provider';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { createPlanner } from './planner.js';

describe('createPlanner', () => {
  it('returns a structurally valid, schema-validated plan referencing only declared tools/agents', async () => {
    const validPlan = {
      id: 'p1',
      goal: 'Check application status',
      steps: [{ id: 's1', type: 'tool', target: 'applications.get', description: 'Fetch the application' }],
    };
    const modelRuntime = createModelRuntime({
      providers: [createMockProvider({ id: 'mock', scenario: { chunks: [JSON.stringify(validPlan)] } })],
      defaultProvider: 'mock',
      defaultModel: 'mock-model',
    });
    const planner = createPlanner({ modelRuntime });

    const plan = await planner.plan('Check application status', ['applications.get'], []);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.target).toBe('applications.get');
  });

  it('rejects a plan that references a tool not in the available list (never invent one)', async () => {
    const invalidPlan = {
      id: 'p1',
      goal: 'Delete everything',
      steps: [{ id: 's1', type: 'tool', target: 'admin.deleteEverything', description: 'nope' }],
    };
    const modelRuntime = createModelRuntime({
      providers: [createMockProvider({ id: 'mock', scenario: { chunks: [JSON.stringify(invalidPlan)] } })],
      defaultProvider: 'mock',
      defaultModel: 'mock-model',
    });
    const planner = createPlanner({ modelRuntime });

    await expect(planner.plan('Delete everything', ['applications.get'], [])).rejects.toMatchObject({
      code: 'AGENT_PLAN_INVALID',
    });
  });

  it('rejects a plan with an unsupported step type (schema rejects non-declarative steps)', async () => {
    const invalidPlan = {
      id: 'p1',
      goal: 'g',
      steps: [{ id: 's1', type: 'eval', target: 'process.exit(1)', description: 'run arbitrary code' }],
    };
    const modelRuntime = createModelRuntime({
      providers: [createMockProvider({ id: 'mock', scenario: { chunks: [JSON.stringify(invalidPlan)] } })],
      defaultProvider: 'mock',
      defaultModel: 'mock-model',
    });
    const planner = createPlanner({ modelRuntime });

    // generateObject's own schema validation rejects this before AGENT_PLAN_INVALID would -
    // either way, the invalid step never becomes a Plan the executor could run.
    await expect(planner.plan('g', [], [])).rejects.toBeTruthy();
  });
});
