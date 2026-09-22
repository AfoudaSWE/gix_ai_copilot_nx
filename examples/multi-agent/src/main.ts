import { createAgentRegistry, createAgentRuntime } from '@gixcopilot/agents';
import type { CopilotEvent } from '@gixcopilot/protocol';
import { createModelRuntime } from '@gixcopilot/provider';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { createStaticToolResolver, createToolRuntime } from '@gixcopilot/tools';
import { createPermissionAwareToolResolver } from '@gixcopilot/security';
import type { SecurityContext } from '@gixcopilot/security';
import { applicationSpecialist, knowledgeSpecialist, orchestratorAgent, paymentSpecialist } from './agents.js';
import { getApplicationTool, getPaymentTool, searchPolicyTool } from './tools.js';

function printEvent(event: CopilotEvent): void {
  switch (event.type) {
    case 'agent.run.started':
      console.log(`[agent] ${event.agentId} started`);
      break;
    case 'agent.delegation.started':
      console.log(`[delegate] ${event.fromAgentId} -> ${event.toAgentId}`);
      break;
    case 'agent.delegation.completed':
      console.log(`[delegate] ${event.fromAgentId} -> ${event.toAgentId}: ${event.status}`);
      break;
    case 'agent.run.completed':
    case 'agent.run.failed':
    case 'agent.run.cancelled':
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
    case 'workflow.run.started':
    case 'workflow.run.paused':
    case 'workflow.run.resumed':
    case 'workflow.run.completed':
    case 'workflow.run.failed':
    case 'workflow.run.cancelled':
    case 'workflow.step.started':
    case 'workflow.step.completed':
    case 'workflow.step.failed':
    case 'workflow.checkpoint.saved':
      break;
  }
}

async function main(): Promise<void> {
  const registry = createAgentRegistry();
  for (const agent of [orchestratorAgent, applicationSpecialist, paymentSpecialist, knowledgeSpecialist]) {
    registry.register(agent);
  }

  // An admin identity - can see payment data. Swap for a bare 'viewer' with no permissions to
  // see the payment specialist's own tool call denied instead (Section 172, 186); the
  // orchestrator still completes either way.
  const securityContext: SecurityContext = {
    tenant: { tenantId: 'demo' },
    identity: { subject: 'user-1', roles: ['admin'], permissions: ['payments.read'] },
  };

  const resolver = createPermissionAwareToolResolver(
    createStaticToolResolver([getApplicationTool, getPaymentTool, searchPolicyTool]),
    securityContext.identity,
  );
  const toolRuntime = createToolRuntime({ resolver });

  const modelRuntime = createModelRuntime({
    providers: [
      createMockProvider({
        id: 'orchestrator-model',
        scenario: (attempt) =>
          attempt === 1
            ? {
                toolCalls: [
                  { id: 'd1', name: 'agent.delegate.application-specialist', arguments: { task: 'Check APP-1024 status' } },
                  { id: 'd2', name: 'agent.delegate.payment-specialist', arguments: { task: 'Check payment verification for user-1' } },
                  { id: 'd3', name: 'agent.delegate.knowledge-specialist', arguments: { task: 'Explain the approval policy' } },
                ],
              }
            : {
                chunks: [
                  'APP-1024 is under review, payment is verified, and applications are approved once identity and payment are confirmed.',
                ],
              },
      }),
      createMockProvider({
        id: 'application-model',
        scenario: (attempt) =>
          attempt === 1
            ? { toolCalls: [{ id: 'c1', name: 'applications.get', arguments: { id: 'APP-1024' } }] }
            : { chunks: ['APP-1024 is under review.'] },
      }),
      createMockProvider({
        id: 'payment-model',
        scenario: (attempt) =>
          attempt === 1
            ? { toolCalls: [{ id: 'c2', name: 'payments.get', arguments: { userId: 'user-1' } }] }
            : { chunks: ['Payment is verified.'] },
      }),
      createMockProvider({
        id: 'knowledge-model',
        scenario: (attempt) =>
          attempt === 1
            ? { toolCalls: [{ id: 'c3', name: 'knowledge.search', arguments: { topic: 'approval' } }] }
            : {
                chunks: [
                  'An application is approved once identity documents are confirmed and the payment method is verified.',
                ],
              },
      }),
    ],
    defaultProvider: 'orchestrator-model',
    defaultModel: 'mock-model',
  });

  const runtime = createAgentRuntime({ registry, modelRuntime, toolRuntime, toolResolver: resolver });

  console.log('> Check APP-1024, verify my payment, and explain the approval policy.\n');
  const result = await runtime.run({
    agent: 'orchestrator',
    input: { message: 'Check APP-1024, verify my payment, and explain the approval policy.' },
    securityContext,
    onEvent: printEvent,
  });

  console.log(`\nStatus: ${result.status}`);
  if (result.status === 'completed') console.log(`Answer: ${String(result.output)}`);
}

main().catch((error: unknown) => {
  console.error('Fatal error running the multi-agent demo:', error);
  process.exitCode = 1;
});
