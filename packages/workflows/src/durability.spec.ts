import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CopilotError } from '@gixcopilot/protocol';
import { defineTool } from '@gixcopilot/tools';
import { createStaticToolResolver, createToolRuntime } from '@gixcopilot/tools';
import { defineWorkflow } from './definition.js';
import { approvalStep, functionStep, toolStep } from './steps.js';
import { createWorkflowTestHarness } from './test-harness.js';
import { createWorkflowEngine } from './engine.js';
import { createInMemoryCheckpointStore } from './checkpoint.js';

const ANONYMOUS = {};

describe('checkpoint + restart (Section 198, 209)', () => {
  it('a second engine instance sharing the same checkpoint store resumes correctly after the first "process" stops', async () => {
    const stateSchema = z.object({ step1: z.boolean(), step2: z.boolean() });
    type State = z.infer<typeof stateSchema>;
    const workflow = defineWorkflow({
      id: 'restart-workflow',
      version: '1',
      state: stateSchema,
      initialState: () => ({ step1: false, step2: false }),
      steps: [
        functionStep<State>({ id: 's1', run: ({ state }) => ({ ...state, step1: true }) }),
        functionStep<State>({ id: 's2', dependencies: ['s1'], run: ({ state }) => ({ ...state, step2: true }) }),
      ],
    });

    const sharedCheckpointStore = createInMemoryCheckpointStore();

    // "Process 1": starts the run, then stops (goes out of scope) without finishing anything
    // else - simulated by simply not calling anything further on this engine instance.
    const engine1 = createWorkflowEngine({ checkpointStore: sharedCheckpointStore });
    engine1.register(workflow);
    const started = await engine1.start({ workflowId: 'restart-workflow', input: {}, securityContext: ANONYMOUS });
    expect(started.status).toBe('completed');

    // "Process 2": a brand-new engine instance, same durable store, re-registers the
    // workflow and resumes purely from the persisted checkpoint.
    const engine2 = createWorkflowEngine({ checkpointStore: sharedCheckpointStore });
    engine2.register(workflow);
    const resumed = await engine2.resume(started.workflowRunId);

    expect(resumed.status).toBe('completed');
    expect(resumed.state).toEqual({ step1: true, step2: true });
  });

  it('rejects resuming a checkpoint against an incompatible workflow version (Section 104, 199, 229)', async () => {
    const stateSchema = z.object({});
    type State = z.infer<typeof stateSchema>;
    const sharedCheckpointStore = createInMemoryCheckpointStore();

    const v1 = defineWorkflow({
      id: 'versioned',
      version: '1',
      state: stateSchema,
      initialState: () => ({}),
      steps: [
        functionStep<State>({
          id: 'wait',
          run: () => {
            throw new Error('never completes in this test');
          },
        }),
      ],
    });
    const engine1 = createWorkflowEngine({ checkpointStore: sharedCheckpointStore, retryPolicy: { maxAttempts: 1 } });
    engine1.register(v1);
    const started = await engine1.start({ workflowId: 'versioned', input: {}, securityContext: ANONYMOUS });
    expect(started.status).toBe('failed');

    // Force it back to a resumable status to exercise the version check in isolation.
    await sharedCheckpointStore.save({ ...started, status: 'paused', version: started.version });

    const v2 = defineWorkflow({
      id: 'versioned',
      version: '2',
      state: stateSchema,
      initialState: () => ({}),
      steps: [functionStep<State>({ id: 'wait', run: ({ state }) => state })],
    });
    const engine2 = createWorkflowEngine({ checkpointStore: sharedCheckpointStore });
    engine2.register(v2);

    await expect(engine2.resume(started.workflowRunId)).rejects.toMatchObject({ code: 'WORKFLOW_RESUME_FAILED' });
  });
});

describe('retry policy (Section 117-119, 200-201)', () => {
  it('retries a transient (retryable) failure and eventually succeeds', async () => {
    let attempts = 0;
    const flaky = defineTool({
      name: 'flaky.call',
      description: 'Fails twice, then succeeds.',
      input: z.object({}),
      execute: () => {
        attempts += 1;
        if (attempts < 3) {
          return Promise.reject(CopilotError.networkError('temporary network failure'));
        }
        return Promise.resolve({ ok: true });
      },
    });

    const stateSchema = z.object({ ok: z.boolean() });
    type State = z.infer<typeof stateSchema>;
    const workflow = defineWorkflow({
      id: 'retry-workflow',
      version: '1',
      state: stateSchema,
      initialState: () => ({ ok: false }),
      steps: [
        toolStep<State>({
          id: 'call',
          tool: 'flaky.call',
          input: () => ({}),
          updateState: () => ({ ok: true }),
        }),
      ],
    });

    const resolver = createStaticToolResolver([flaky]);
    const toolRuntime = createToolRuntime({ resolver });
    const engine = createWorkflowEngine({ toolRuntime, retryPolicy: { maxAttempts: 5, backoffMs: () => 0 } });
    engine.register(workflow);

    const checkpoint = await engine.start({ workflowId: 'retry-workflow', input: {}, securityContext: ANONYMOUS });
    expect(checkpoint.status).toBe('completed');
    expect(attempts).toBe(3);
  });

  it('does not retry a non-retryable failure (no retry storm, Section 201)', async () => {
    let attempts = 0;
    const denied = defineTool({
      name: 'denied.call',
      description: 'Always permission-denied.',
      input: z.object({}),
      execute: () => {
        attempts += 1;
        return Promise.reject(CopilotError.permissionDenied('denied.call'));
      },
    });

    const stateSchema = z.object({});
    type State = z.infer<typeof stateSchema>;
    const workflow = defineWorkflow({
      id: 'no-retry-workflow',
      version: '1',
      state: stateSchema,
      initialState: () => ({}),
      steps: [toolStep<State>({ id: 'call', tool: 'denied.call', input: () => ({}), updateState: (state) => state })],
    });

    const resolver = createStaticToolResolver([denied]);
    const toolRuntime = createToolRuntime({ resolver });
    const engine = createWorkflowEngine({ toolRuntime, retryPolicy: { maxAttempts: 5, backoffMs: () => 0 } });
    engine.register(workflow);

    const checkpoint = await engine.start({ workflowId: 'no-retry-workflow', input: {}, securityContext: ANONYMOUS });
    expect(checkpoint.status).toBe('failed');
    expect(attempts).toBe(1);
  });
});

describe('compensation (Section 119-121, 202)', () => {
  it('runs declared compensations in reverse order when a later step fails', async () => {
    const executed: string[] = [];
    const reserveInventory = defineTool({
      name: 'inventory.reserve',
      description: 'Reserve inventory.',
      input: z.object({}),
      execute: () => {
        executed.push('reserve');
        return Promise.resolve({ ok: true });
      },
    });
    const releaseInventory = defineTool({
      name: 'inventory.release',
      description: 'Release inventory.',
      input: z.object({}),
      execute: () => {
        executed.push('release');
        return Promise.resolve({ ok: true });
      },
    });
    const chargePayment = defineTool({
      name: 'payment.charge',
      description: 'Charge payment.',
      input: z.object({}),
      execute: () => {
        executed.push('charge');
        return Promise.resolve({ ok: true });
      },
    });
    const refundPayment = defineTool({
      name: 'payment.refund',
      description: 'Refund payment.',
      input: z.object({}),
      execute: () => {
        executed.push('refund');
        return Promise.resolve({ ok: true });
      },
    });
    const createShipment = defineTool({
      name: 'shipment.create',
      description: 'Always fails in this test.',
      input: z.object({}),
      execute: () => {
        executed.push('shipment-attempt');
        return Promise.reject(CopilotError.provider('carrier unavailable', undefined, false));
      },
    });

    const stateSchema = z.object({});
    type State = z.infer<typeof stateSchema>;
    const workflow = defineWorkflow({
      id: 'compensation-workflow',
      version: '1',
      state: stateSchema,
      initialState: () => ({}),
      steps: [
        toolStep<State>({
          id: 'reserve',
          tool: 'inventory.reserve',
          input: () => ({}),
          updateState: (state) => state,
          compensate: { tool: 'inventory.release', input: () => ({}) },
        }),
        toolStep<State>({
          id: 'charge',
          dependencies: ['reserve'],
          tool: 'payment.charge',
          input: () => ({}),
          updateState: (state) => state,
          compensate: { tool: 'payment.refund', input: () => ({}) },
        }),
        toolStep<State>({
          id: 'ship',
          dependencies: ['charge'],
          tool: 'shipment.create',
          input: () => ({}),
          updateState: (state) => state,
        }),
      ],
    });

    const resolver = createStaticToolResolver([
      reserveInventory,
      releaseInventory,
      chargePayment,
      refundPayment,
      createShipment,
    ]);
    const toolRuntime = createToolRuntime({ resolver });
    const engine = createWorkflowEngine({ toolRuntime, retryPolicy: { maxAttempts: 1 } });
    engine.register(workflow);

    const checkpoint = await engine.start({ workflowId: 'compensation-workflow', input: {}, securityContext: ANONYMOUS });

    expect(checkpoint.status).toBe('failed');
    expect(executed).toEqual(['reserve', 'charge', 'shipment-attempt', 'refund', 'release']);
  });
});

describe('cancellation (Section 203, 226)', () => {
  it('cancel() marks a waiting run as cancelled and cancels its pending approval', async () => {
    const stateSchema = z.object({});
    type State = z.infer<typeof stateSchema>;
    const workflow = defineWorkflow({
      id: 'cancel-workflow',
      version: '1',
      state: stateSchema,
      initialState: () => ({}),
      steps: [approvalStep<State>({ id: 'wait-approval', action: 'do-thing', summary: () => 'do the thing' })],
    });

    const { engine, approvals } = createWorkflowTestHarness({ workflows: [workflow] });

    const started = await engine.start({ workflowId: 'cancel-workflow', input: {}, securityContext: ANONYMOUS });
    expect(started.status).toBe('waiting_for_approval');

    const cancelled = await engine.cancel(started.workflowRunId);
    expect(cancelled.status).toBe('cancelled');

    const approvalId = started.pendingApproval?.approvalId;
    expect(approvalId).toBeDefined();
    const approval = await approvals.get(approvalId ?? '');
    expect(approval?.status).toBe('cancelled');
  });
});

describe('tenant isolation (Section 129-130, 204)', () => {
  it('a caller trusted for a different tenant cannot resume, cancel, or inspect the run', async () => {
    const stateSchema = z.object({});
    type State = z.infer<typeof stateSchema>;
    const workflow = defineWorkflow({
      id: 'tenant-workflow',
      version: '1',
      state: stateSchema,
      initialState: () => ({}),
      steps: [functionStep<State>({ id: 's1', run: ({ state }) => state })],
    });

    const { engine } = createWorkflowTestHarness({ workflows: [workflow] });
    const tenantA = { identity: { subject: 'user-a', roles: [], permissions: [] }, tenant: { tenantId: 'tenant-a' } };
    const tenantB = { identity: { subject: 'user-b', roles: [], permissions: [] }, tenant: { tenantId: 'tenant-b' } };

    const started = await engine.start({
      workflowId: 'tenant-workflow',
      input: {},
      securityContext: tenantA,
      tenantId: 'tenant-a',
    });
    expect(started.status).toBe('completed');

    await expect(engine.getCheckpoint(started.workflowRunId, tenantB)).rejects.toMatchObject({ code: 'TENANT_MISMATCH' });
    await expect(engine.cancel(started.workflowRunId, tenantB)).rejects.toMatchObject({ code: 'TENANT_MISMATCH' });
    await expect(engine.resume(started.workflowRunId, { securityContext: tenantB })).rejects.toMatchObject({
      code: 'TENANT_MISMATCH',
    });

    // The rightful tenant can still inspect it.
    const ownCheckpoint = await engine.getCheckpoint(started.workflowRunId, tenantA);
    expect(ownCheckpoint?.status).toBe('completed');
  });
});
