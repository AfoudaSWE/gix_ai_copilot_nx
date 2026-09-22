import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '@gixcopilot/tools';
import { defineWorkflow } from './definition.js';
import { conditionStep, functionStep, parallelStep, toolStep } from './steps.js';
import { createWorkflowTestHarness } from './test-harness.js';

const ANONYMOUS = {};

describe('sequential workflow execution', () => {
  it('runs steps in dependency order and completes', async () => {
    const order: string[] = [];
    const stateSchema = z.object({ value: z.number() });
    type State = z.infer<typeof stateSchema>;

    const workflow = defineWorkflow({
      id: 'sequential',
      version: '1',
      input: z.object({ start: z.number() }),
      state: stateSchema,
      output: z.object({ value: z.number() }),
      initialState: (input) => ({ value: input.start }),
      toOutput: (state) => ({ value: state.value }),
      steps: [
        functionStep<State>({
          id: 's1',
          run: ({ state }) => {
            order.push('s1');
            return { value: state.value + 1 };
          },
        }),
        functionStep<State>({
          id: 's2',
          dependencies: ['s1'],
          run: ({ state }) => {
            order.push('s2');
            return { value: state.value * 2 };
          },
        }),
      ],
    });

    const { engine } = createWorkflowTestHarness({ workflows: [workflow] });
    const checkpoint = await engine.start({ workflowId: 'sequential', input: { start: 1 }, securityContext: ANONYMOUS });

    expect(checkpoint.status).toBe('completed');
    expect(checkpoint.state).toEqual({ value: 4 });
    expect(order).toEqual(['s1', 's2']);
  });

  it('runs a real tool step through the ToolRuntime', async () => {
    const getApplication = defineTool({
      name: 'applications.get',
      description: 'Get an application.',
      input: z.object({ id: z.string() }),
      execute: (input) => Promise.resolve({ id: input.id, status: 'approved' }),
    });

    const stateSchema = z.object({ id: z.string(), status: z.string().optional() });
    type State = z.infer<typeof stateSchema>;

    const workflow = defineWorkflow({
      id: 'tool-workflow',
      version: '1',
      input: z.object({ id: z.string() }),
      state: stateSchema,
      initialState: (input) => ({ id: input.id, status: undefined }),
      steps: [
        toolStep<State>({
          id: 'fetch',
          tool: 'applications.get',
          input: ({ state }) => ({ id: state.id }),
          updateState: (state, output) => ({ ...state, status: (output as { status: string }).status }),
        }),
      ],
    });

    const { engine } = createWorkflowTestHarness({ workflows: [workflow], tools: [getApplication] });
    const checkpoint = await engine.start({ workflowId: 'tool-workflow', input: { id: 'APP-1' }, securityContext: ANONYMOUS });

    expect(checkpoint.status).toBe('completed');
    expect(checkpoint.state).toEqual({ id: 'APP-1', status: 'approved' });
  });
});

describe('condition step and branching', () => {
  it('skips a step whose runIf predicate reads the condition result and is false', async () => {
    const ran: string[] = [];
    const stateSchema = z.object({ amount: z.number(), isLarge: z.boolean() });
    type State = z.infer<typeof stateSchema>;

    const workflow = defineWorkflow({
      id: 'branching',
      version: '1',
      input: z.object({ amount: z.number() }),
      state: stateSchema,
      initialState: (input) => ({ amount: input.amount, isLarge: false }),
      steps: [
        conditionStep<State>({
          id: 'check',
          evaluate: ({ state }) => state.amount > 1000,
          updateState: (state, result) => ({ ...state, isLarge: result }),
        }),
        functionStep<State>({
          id: 'large-path',
          dependencies: ['check'],
          runIf: ({ state }) => state.isLarge,
          run: ({ state }) => {
            ran.push('large-path');
            return state;
          },
        }),
        functionStep<State>({
          id: 'small-path',
          dependencies: ['check'],
          runIf: ({ state }) => !state.isLarge,
          run: ({ state }) => {
            ran.push('small-path');
            return state;
          },
        }),
      ],
    });

    const { engine } = createWorkflowTestHarness({ workflows: [workflow] });
    const checkpoint = await engine.start({ workflowId: 'branching', input: { amount: 50 }, securityContext: ANONYMOUS });

    expect(checkpoint.status).toBe('completed');
    expect(ran).toEqual(['small-path']);
    const largeRecord = checkpoint.steps.find((step) => step.stepId === 'large-path');
    expect(largeRecord?.status).toBe('skipped');
  });
});

describe('parallel step execution', () => {
  it('runs independent branches concurrently and joins the results', async () => {
    const stateSchema = z.object({ paymentOk: z.boolean(), documentsOk: z.boolean() });
    type State = z.infer<typeof stateSchema>;

    const workflow = defineWorkflow({
      id: 'parallel',
      version: '1',
      state: stateSchema,
      initialState: () => ({ paymentOk: false, documentsOk: false }),
      steps: [
        functionStep<State>({ id: 'check-payment', run: ({ state }) => ({ ...state, paymentOk: true }) }),
        functionStep<State>({ id: 'check-documents', run: ({ state }) => ({ ...state, documentsOk: true }) }),
        parallelStep<State>({ id: 'checks', branches: ['check-payment', 'check-documents'] }),
      ],
    });

    const { engine } = createWorkflowTestHarness({ workflows: [workflow] });
    const checkpoint = await engine.start({ workflowId: 'parallel', input: {}, securityContext: ANONYMOUS });

    expect(checkpoint.status).toBe('completed');
    expect(checkpoint.state).toEqual({ paymentOk: true, documentsOk: true });
  });

  it('fails the parallel step and the run when a branch fails', async () => {
    const stateSchema = z.object({});
    type State = z.infer<typeof stateSchema>;

    const workflow = defineWorkflow({
      id: 'parallel-fail',
      version: '1',
      state: stateSchema,
      initialState: () => ({}),
      steps: [
        functionStep<State>({ id: 'ok-branch', run: ({ state }) => state }),
        functionStep<State>({
          id: 'bad-branch',
          run: () => {
            throw new Error('branch failed');
          },
        }),
        parallelStep<State>({ id: 'checks', branches: ['ok-branch', 'bad-branch'] }),
      ],
    });

    const { engine } = createWorkflowTestHarness({ workflows: [workflow] });
    const checkpoint = await engine.start({ workflowId: 'parallel-fail', input: {}, securityContext: ANONYMOUS });

    expect(checkpoint.status).toBe('failed');
    const badBranch = checkpoint.steps.find((step) => step.stepId === 'bad-branch');
    expect(badBranch?.status).toBe('failed');
  });
});
