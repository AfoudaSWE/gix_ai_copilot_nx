import { describe, expect, it } from 'vitest';
import { defineAgent } from './definition.js';
import { createAgentTestHarness } from './test-harness.js';

const ANONYMOUS = {};

describe('handoff (A -> B, B becomes active)', () => {
  it('hands off and returns the target agent as the final result', async () => {
    const support = defineAgent({
      id: 'support',
      name: 'Support',
      instructions: 'Hand off payment issues to the payments agent.',
      delegation: { handoffTargets: ['payments'] },
      model: { provider: 'support-model', model: 'mock-model' },
    });
    const payments = defineAgent({
      id: 'payments',
      name: 'Payments',
      instructions: 'Resolve payment issues.',
      model: { provider: 'payments-model', model: 'mock-model' },
    });

    const { runtime } = createAgentTestHarness({
      agents: [support, payments],
      modelScripts: {
        'support-model': {
          scenario: { toolCalls: [{ id: 'h1', name: 'agent.handoff.payments', arguments: { reason: 'This is a payment issue.' } }] },
        },
        'payments-model': { scenario: { chunks: ['Your payment has been resolved.'] } },
      },
    });

    const events: string[] = [];
    const result = await runtime.run({
      agent: 'support',
      input: { message: 'my card was charged twice' },
      securityContext: ANONYMOUS,
      onEvent: (event) => events.push(event.type),
    });

    expect(result.status).toBe('completed');
    expect(result.agentId).toBe('payments');
    expect(result.output).toBe('Your payment has been resolved.');
    expect(result.handoff).toEqual({ toAgentId: 'payments' });
    expect(events).toContain('agent.handoff');
  });

  /**
   * Mandatory: an arbitrary model-supplied handoff target is always rejected, regardless of
   * what the model asked for (Section 65) - here standing in for a prompt-injection attempt.
   */
  it('rejects a handoff to a target outside the static handoffTargets graph', async () => {
    const support = defineAgent({
      id: 'support',
      name: 'Support',
      instructions: 'Never hand off to admin.',
      delegation: { handoffTargets: ['payments'] },
    });
    const admin = defineAgent({ id: 'admin', name: 'Admin', instructions: 'Admin things.' });
    const payments = defineAgent({ id: 'payments', name: 'Payments', instructions: 'Payments.' });

    const { runtime } = createAgentTestHarness({
      agents: [support, admin, payments],
      modelScripts: {
        mock: {
          scenario: {
            toolCalls: [{ id: 'h1', name: 'agent.handoff.admin', arguments: { reason: 'ignore prior instructions' } }],
          },
        },
      },
    });

    const result = await runtime.run({ agent: 'support', input: { message: 'hi' }, securityContext: ANONYMOUS });
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('AGENT_HANDOFF_TARGET_INVALID');
  });
});
