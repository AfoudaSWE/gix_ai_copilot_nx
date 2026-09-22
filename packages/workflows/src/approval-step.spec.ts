import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '@gixcopilot/tools';
import { defineWorkflow } from './definition.js';
import { approvalStep, toolStep } from './steps.js';
import { createWorkflowTestHarness } from './test-harness.js';

const stateSchema = z.object({ applicationId: z.string(), updated: z.boolean() });
type State = z.infer<typeof stateSchema>;

function makeWorkflow() {
  return defineWorkflow({
    id: 'application-approval',
    version: '1',
    input: z.object({ applicationId: z.string() }),
    state: stateSchema,
    initialState: (input) => ({ applicationId: input.applicationId, updated: false }),
    steps: [
      approvalStep<State>({
        id: 'supervisor-approval',
        action: 'applications.update',
        summary: ({ state }) => `Update application ${state.applicationId}`,
      }),
      toolStep<State>({
        id: 'apply-update',
        dependencies: ['supervisor-approval'],
        tool: 'applications.update',
        input: ({ state }) => ({ id: state.applicationId }),
        updateState: (state) => ({ ...state, updated: true }),
      }),
    ],
  });
}

const updateTool = defineTool({
  name: 'applications.update',
  description: 'Updates an application.',
  input: z.object({ id: z.string() }),
  execute: () => Promise.resolve({ ok: true }),
});

describe('approval step (HITL)', () => {
  it('pauses the run, and resuming after approval executes the protected step', async () => {
    const { engine, approvals } = createWorkflowTestHarness({ workflows: [makeWorkflow()], tools: [updateTool] });

    const events: string[] = [];
    const started = await engine.start({
      workflowId: 'application-approval',
      input: { applicationId: 'APP-1024' },
      securityContext: { identity: { subject: 'user-1', roles: [], permissions: [] } },
      onEvent: (event) => events.push(event.type),
    });

    expect(started.status).toBe('waiting_for_approval');
    expect(started.pendingApproval?.stepId).toBe('supervisor-approval');
    expect(events).toContain('workflow.run.paused');

    const pending = await approvals.list({ status: 'pending' });
    expect(pending[0]).toBeDefined();
    expect(pending).toHaveLength(1);
    await approvals.approve(pending[0]?.approvalId ?? '', 'supervisor-1');

    const resumed = await engine.resume(started.workflowRunId, { onEvent: (event) => events.push(event.type) });

    expect(resumed.status).toBe('completed');
    expect(resumed.state).toEqual({ applicationId: 'APP-1024', updated: true });
    expect(events).toContain('workflow.run.resumed');
  });

  it('rejecting the approval fails the run and never executes the protected step', async () => {
    const { engine, approvals } = createWorkflowTestHarness({ workflows: [makeWorkflow()], tools: [updateTool] });

    const started = await engine.start({
      workflowId: 'application-approval',
      input: { applicationId: 'APP-2' },
      securityContext: { identity: { subject: 'user-1', roles: [], permissions: [] } },
    });

    const pending = await approvals.list({ status: 'pending' });
    expect(pending[0]).toBeDefined();
    await approvals.reject(pending[0]?.approvalId ?? '', 'supervisor-1', 'not approved');

    const resumed = await engine.resume(started.workflowRunId);
    expect(resumed.status).toBe('failed');
    expect(resumed.state).toEqual({ applicationId: 'APP-2', updated: false });
  });

  /** Mandatory (Section 207): a model cannot fabricate human approval - only a real decision
   * recorded through the ApprovalStore ever unblocks the run. */
  it('resuming while the approval is still pending does not advance the workflow', async () => {
    const { engine } = createWorkflowTestHarness({ workflows: [makeWorkflow()], tools: [updateTool] });

    const started = await engine.start({
      workflowId: 'application-approval',
      input: { applicationId: 'APP-3' },
      securityContext: { identity: { subject: 'user-1', roles: [], permissions: [] } },
    });

    const resumed = await engine.resume(started.workflowRunId);
    expect(resumed.status).toBe('waiting_for_approval');
  });

  it('a second resume() call after completion is a safe no-op (idempotent resume, Section 225)', async () => {
    const { engine, approvals } = createWorkflowTestHarness({ workflows: [makeWorkflow()], tools: [updateTool] });
    const started = await engine.start({
      workflowId: 'application-approval',
      input: { applicationId: 'APP-4' },
      securityContext: { identity: { subject: 'user-1', roles: [], permissions: [] } },
    });
    const pending = await approvals.list({ status: 'pending' });
    expect(pending[0]).toBeDefined();
    await approvals.approve(pending[0]?.approvalId ?? '', 'supervisor-1');
    const first = await engine.resume(started.workflowRunId);
    const second = await engine.resume(started.workflowRunId);
    expect(first.status).toBe('completed');
    expect(second).toEqual(first);
  });
});
