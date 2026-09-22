import { createAgentRegistry, createAgentRuntime } from '@gixcopilot/agents';
import { createWorkflowEngine } from '@gixcopilot/workflows';
import type { CopilotEvent } from '@gixcopilot/protocol';
import { createModelRuntime } from '@gixcopilot/provider';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';
import { createStaticToolResolver, createToolRuntime } from '@gixcopilot/tools';
import { createInMemoryApprovalStore } from '@gixcopilot/security';
import type { SecurityContext } from '@gixcopilot/security';
import { applicationReviewAgent } from './agent.js';
import { updateApplicationTool, verifyPaymentTool } from './tools.js';
import { createApplicationApprovalWorkflow } from './workflow.js';

function printEvent(event: CopilotEvent): void {
  switch (event.type) {
    case 'workflow.run.started':
      console.log(`[workflow] started (run ${event.workflowRunId})`);
      break;
    case 'workflow.run.paused':
      console.log(`[workflow] paused: ${event.reason}${event.stepId ? ` (step ${event.stepId})` : ''}`);
      break;
    case 'workflow.run.resumed':
      console.log('[workflow] resumed');
      break;
    case 'workflow.run.completed':
      console.log('[workflow] completed');
      break;
    case 'workflow.run.failed':
      console.log(`[workflow] failed: ${event.error.code}`);
      break;
    case 'workflow.step.started':
      console.log(`[step] ${event.stepId} started (attempt ${event.attempt})`);
      break;
    case 'workflow.step.completed':
      console.log(`[step] ${event.stepId} completed`);
      break;
    case 'workflow.step.failed':
      console.log(`[step] ${event.stepId} failed: ${event.error.code}`);
      break;
    case 'agent.run.started':
    case 'agent.run.completed':
    case 'agent.run.failed':
    case 'agent.run.cancelled':
    case 'agent.delegation.started':
    case 'agent.delegation.completed':
    case 'agent.handoff':
    case 'agent.routing.decided':
    case 'run.started':
    case 'run.completed':
    case 'run.failed':
    case 'run.cancelled':
    case 'error':
    case 'message.started':
    case 'message.delta':
    case 'message.end':
    case 'tool.requested':
    case 'tool.started':
    case 'tool.completed':
    case 'tool.failed':
    case 'approval.requested':
    case 'approval.approved':
    case 'approval.rejected':
    case 'approval.expired':
    case 'workflow.run.cancelled':
    case 'workflow.checkpoint.saved':
      break;
  }
}

async function main(): Promise<void> {
  const providerId = process.env['MODEL_PROVIDER'] ?? 'mock';
  const openaiApiKey = process.env['OPENAI_API_KEY'];
  const usingOpenAI = providerId === 'openai' && Boolean(openaiApiKey);
  const modelName = usingOpenAI ? (process.env['MODEL_NAME'] ?? 'gpt-4o-mini') : 'mock-model';

  const agentRegistry = createAgentRegistry();
  agentRegistry.register(applicationReviewAgent);
  const agentModelRuntime = createModelRuntime({
    providers: [
      createMockProvider({ id: 'mock', scenario: { chunks: ['APP-1024 is submitted and payment-verified, ready for review.'] } }),
      ...(openaiApiKey ? [createOpenAIProvider({ apiKey: openaiApiKey })] : []),
    ],
    defaultProvider: usingOpenAI ? 'openai' : 'mock',
    defaultModel: modelName,
  });
  const agentToolResolver = createStaticToolResolver([]);
  const agentRuntime = createAgentRuntime({
    registry: agentRegistry,
    modelRuntime: agentModelRuntime,
    toolRuntime: createToolRuntime({ resolver: agentToolResolver }),
    toolResolver: agentToolResolver,
  });

  const resolver = createStaticToolResolver([verifyPaymentTool, updateApplicationTool]);
  const toolRuntime = createToolRuntime({ resolver });
  const approvals = createInMemoryApprovalStore();

  const engine = createWorkflowEngine({ toolRuntime, agentRuntime, approvals });
  engine.register(createApplicationApprovalWorkflow());

  const securityContext: SecurityContext = {
    tenant: { tenantId: 'demo' },
    identity: { subject: 'user-1', roles: ['operator'], permissions: ['applications.update'] },
  };

  console.log('Starting the application-approval workflow for APP-1024...\n');
  const started = await engine.start({
    workflowId: 'application-approval',
    input: { applicationId: 'APP-1024' },
    securityContext,
    onEvent: printEvent,
  });
  console.log(`\nAfter start(): status = ${started.status}`);

  if (started.status === 'waiting_for_approval') {
    const pending = await approvals.list({ status: 'pending' });
    const approval = pending[0];
    if (!approval) throw new Error('Expected a pending approval.');
    console.log(`\nA supervisor approves: "${approval.summary}"`);
    await approvals.approve(approval.approvalId, 'supervisor-1');

    console.log('\nResuming the workflow after approval...\n');
    const resumed = await engine.resume(started.workflowRunId, { onEvent: printEvent, securityContext });
    console.log(`\nAfter resume(): status = ${resumed.status}`);
    console.log('Final state:', resumed.state);
  }
}

main().catch((error: unknown) => {
  console.error('Fatal error running the workflow-approval demo:', error);
  process.exitCode = 1;
});
