import { describe, expect, it } from 'vitest';
import { createAgentRegistry, createAgentRuntime } from '@gixcopilot/agents';
import { createModelRuntime } from '@gixcopilot/provider';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { createStaticToolResolver, createToolRuntime } from '@gixcopilot/tools';
import { createPermissionAwareToolResolver } from '@gixcopilot/security';
import type { Identity } from '@gixcopilot/security';
import { applicationSpecialist, knowledgeSpecialist, orchestratorAgent, paymentSpecialist } from './agents.js';
import { getApplicationTool, getPaymentTool, searchPolicyTool } from './tools.js';

function buildRuntime(identity: Identity, paymentCalls: { count: number }) {
  const registry = createAgentRegistry();
  for (const agent of [orchestratorAgent, applicationSpecialist, paymentSpecialist, knowledgeSpecialist]) {
    registry.register(agent);
  }
  // A call-counting wrapper around the real payment tool (never a mock of the security
  // pipeline itself) - proves the tool's own execute() was or was not actually reached, which
  // is a stronger assertion than inspecting the model's own (independently scripted) text.
  const spiedPaymentTool = {
    ...getPaymentTool,
    execute: (input: { userId: string }, context: Parameters<typeof getPaymentTool.execute>[1]) => {
      paymentCalls.count += 1;
      return getPaymentTool.execute(input, context);
    },
  };
  const resolver = createPermissionAwareToolResolver(
    createStaticToolResolver([getApplicationTool, spiedPaymentTool, searchPolicyTool]),
    identity,
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
                  { id: 'd1', name: 'agent.delegate.application-specialist', arguments: { task: 'status' } },
                  { id: 'd2', name: 'agent.delegate.payment-specialist', arguments: { task: 'payment' } },
                ],
              }
            : { chunks: ['combined answer'] },
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
            : { chunks: ['Reported payment status.'] },
      }),
      createMockProvider({ id: 'knowledge-model', scenario: { chunks: ['n/a'] } }),
    ],
    defaultProvider: 'orchestrator-model',
    defaultModel: 'mock-model',
  });
  const runtime = createAgentRuntime({
    registry,
    modelRuntime,
    toolRuntime,
    toolResolver: resolver,
  });
  return runtime;
}

describe('multi-agent: orchestrator delegates to specialists with different access', () => {
  it('an admin sees both application status and real payment verification', async () => {
    const admin: Identity = { subject: 'user-1', roles: ['admin'], permissions: ['payments.read'] };
    const paymentCalls = { count: 0 };
    const runtime = buildRuntime(admin, paymentCalls);

    const events: { type: string; toAgentId?: string; status?: string }[] = [];
    const result = await runtime.run({
      agent: 'orchestrator',
      input: { message: 'Check status and payment' },
      securityContext: { tenant: { tenantId: 'demo' }, identity: admin },
      onEvent: (event) => events.push(event as never),
    });

    expect(result.status).toBe('completed');
    const delegationOutcomes = events.filter((event) => event.type === 'agent.delegation.completed');
    expect(delegationOutcomes).toHaveLength(2);
    expect(delegationOutcomes.every((event) => event.status === 'completed')).toBe(true);
    expect(paymentCalls.count).toBe(1);
  });

  /**
   * Mandatory (Phase 10 Section 172, 186, 191): delegating to a specialist that declares a
   * permission-gated tool must never grant a caller who lacks that permission access to it -
   * the trusted user's own SecurityContext is what is actually checked, never the
   * orchestrator's own declared tool ceiling or the specialist's own declaration.
   */
  it('a viewer without payments.read never actually reaches the payment tool, even via delegation', async () => {
    const viewer: Identity = { subject: 'user-2', roles: ['viewer'], permissions: [] };
    const paymentCalls = { count: 0 };
    const runtime = buildRuntime(viewer, paymentCalls);

    const result = await runtime.run({
      agent: 'orchestrator',
      input: { message: 'Check status and payment' },
      securityContext: { tenant: { tenantId: 'demo' }, identity: viewer },
    });

    // The orchestrator still completes overall (delegation itself is allowed) - but the
    // payment specialist's own tool call was denied by the permission-aware resolver before
    // ever reaching the real tool's execute().
    expect(result.status).toBe('completed');
    expect(paymentCalls.count).toBe(0);
  });
});
