import { afterEach, describe, expect, it } from 'vitest';
import { createAgentRegistry, createAgentRuntime } from '@gixcopilot/agents';
import type { AgentRuntime } from '@gixcopilot/agents';
import { createInMemoryCheckpointStore, createWorkflowEngine, createWorkflowTestHarness } from '@gixcopilot/workflows';
import { createInMemoryApprovalStore } from '@gixcopilot/security';
import { createModelRuntime } from '@gixcopilot/provider';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { createStaticToolResolver, createToolRuntime } from '@gixcopilot/tools';
import { applicationReviewAgent } from './agent.js';
import { getApplication, resetExampleApplications, updateApplicationTool, verifyPaymentTool } from './tools.js';
import { createApplicationApprovalWorkflow } from './workflow.js';
import type { ApplicationApprovalState } from './workflow.js';

const securityContext = {
  tenant: { tenantId: 'demo' },
  identity: { subject: 'user-1', roles: ['operator'], permissions: ['applications.update'] },
};

/** A deterministic stand-in for the "application-agent" workflow step (Section 91, 231-232) -
 * zero network, matching every other test in this repo. */
function createTestAgentRuntime(): AgentRuntime {
  const registry = createAgentRegistry();
  registry.register(applicationReviewAgent);
  const modelRuntime = createModelRuntime({
    providers: [createMockProvider({ id: 'mock', scenario: { chunks: ['Application summary.'] } })],
    defaultProvider: 'mock',
    defaultModel: 'mock-model',
  });
  const resolver = createStaticToolResolver([]);
  return createAgentRuntime({ registry, modelRuntime, toolRuntime: createToolRuntime({ resolver }), toolResolver: resolver });
}

describe('workflow-approval: validate -> agent -> payment -> approval -> update', () => {
  afterEach(() => {
    resetExampleApplications();
  });

  it('pauses for a real supervisor approval, then applies the update only after it is granted', async () => {
    const { engine, approvals } = createWorkflowTestHarness({
      workflows: [createApplicationApprovalWorkflow()],
      tools: [verifyPaymentTool, updateApplicationTool],
      agentRuntime: createTestAgentRuntime(),
    });

    const started = await engine.start({
      workflowId: 'application-approval',
      input: { applicationId: 'APP-1024' },
      securityContext,
    });
    expect(started.status).toBe('waiting_for_approval');
    expect((started.state as ApplicationApprovalState).paymentVerified).toBe(true);
    expect(getApplication('APP-1024')?.status).toBe('submitted'); // Not yet applied.

    const pending = await approvals.list({ status: 'pending' });
    expect(pending).toHaveLength(1);
    await approvals.approve(pending[0]?.approvalId ?? '', 'supervisor-1');

    const resumed = await engine.resume(started.workflowRunId, { securityContext });
    expect(resumed.status).toBe('completed');
    expect((resumed.state as ApplicationApprovalState).updated).toBe(true);
    expect(getApplication('APP-1024')?.status).toBe('approved');
  });

  it('rejecting the approval never applies the update (Section 92, 197)', async () => {
    const { engine, approvals } = createWorkflowTestHarness({
      workflows: [createApplicationApprovalWorkflow()],
      tools: [verifyPaymentTool, updateApplicationTool],
      agentRuntime: createTestAgentRuntime(),
    });

    const started = await engine.start({
      workflowId: 'application-approval',
      input: { applicationId: 'APP-1024' },
      securityContext,
    });
    const pending = await approvals.list({ status: 'pending' });
    await approvals.reject(pending[0]?.approvalId ?? '', 'supervisor-1', 'needs more info');

    const resumed = await engine.resume(started.workflowRunId, { securityContext });
    expect(resumed.status).toBe('failed');
    expect(getApplication('APP-1024')?.status).toBe('submitted');
  });

  /** Mandatory (Section 198, 209): a real process restart, simulated by a brand-new engine
   * instance sharing only the persistent stores (checkpoint + approval), resumes correctly -
   * built with `createWorkflowEngine` directly (not the test harness, which always creates
   * its own fresh stores) so both "process" instances genuinely share durable state, the same
   * way a real deployment shares `@gixcopilot/checkpoint-postgres` and a persistent
   * `ApprovalStore` across worker restarts. */
  it('survives a "process restart" - a second engine instance resumes from the persisted checkpoint', async () => {
    const checkpointStore = createInMemoryCheckpointStore();
    const approvals = createInMemoryApprovalStore();
    const toolRuntime = createToolRuntime({ resolver: createStaticToolResolver([verifyPaymentTool, updateApplicationTool]) });

    const engine1 = createWorkflowEngine({ checkpointStore, approvals, toolRuntime, agentRuntime: createTestAgentRuntime() });
    engine1.register(createApplicationApprovalWorkflow());
    const started = await engine1.start({
      workflowId: 'application-approval',
      input: { applicationId: 'APP-1024' },
      securityContext,
    });
    expect(started.status).toBe('waiting_for_approval');
    const pending = await approvals.list({ status: 'pending' });
    await approvals.approve(pending[0]?.approvalId ?? '', 'supervisor-1');

    // "Process 2": a brand-new engine instance, re-registers the workflow, resumes purely
    // from the shared persisted checkpoint + approval decision.
    const engine2 = createWorkflowEngine({ checkpointStore, approvals, toolRuntime, agentRuntime: createTestAgentRuntime() });
    engine2.register(createApplicationApprovalWorkflow());
    const resumed = await engine2.resume(started.workflowRunId, { securityContext });

    expect(resumed.status).toBe('completed');
    expect(getApplication('APP-1024')?.status).toBe('approved');
  });
});
