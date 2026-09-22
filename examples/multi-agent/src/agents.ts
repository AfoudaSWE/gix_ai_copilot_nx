import { defineAgent } from '@gixcopilot/agents';

/**
 * Specialist principle (Section 52-55): each specialist has narrow instructions, a limited
 * tool set, and one clear responsibility - never a giant, omnipotent agent.
 */
export const applicationSpecialist = defineAgent({
  id: 'application-specialist',
  name: 'Application Specialist',
  description: 'Looks up application records.',
  instructions: 'Answer questions about a specific application using applications.get.',
  tools: ['applications.get'],
  model: { provider: 'application-model', model: 'mock-model' },
});

export const paymentSpecialist = defineAgent({
  id: 'payment-specialist',
  name: 'Payment Specialist',
  description: "Looks up a user's payment verification status.",
  instructions: "Answer questions about a user's payment verification using payments.get.",
  tools: ['payments.get'],
  model: { provider: 'payment-model', model: 'mock-model' },
});

export const knowledgeSpecialist = defineAgent({
  id: 'knowledge-specialist',
  name: 'Knowledge Specialist',
  description: 'Explains general policy questions.',
  instructions: 'Answer general policy questions using knowledge.search.',
  tools: ['knowledge.search'],
  model: { provider: 'knowledge-model', model: 'mock-model' },
});

/**
 * Least privilege (Section 54-55): the orchestrator never CALLS any of these tools itself
 * (its own instructions only ever delegate) - `tools` here is a declared CEILING for
 * delegation, not something it exercises directly. `@gixcopilot/agents`' runtime intersects a
 * delegated run's tools with its delegator's own visible set on every hop
 * (`intersectToolNames`, Section 55's "never their union") - so this list must name every
 * tool a specialist might legitimately need, or that specialist's real tool calls are denied
 * regardless of what it declares for itself. The union here is still never what actually
 * authorizes a call: `payments.get`'s own `requiredPermissions` and the trusted
 * `SecurityContext` are what's actually checked (Section 172, 186) - proven below in
 * `integration.spec.ts`.
 */
export const orchestratorAgent = defineAgent({
  id: 'orchestrator',
  name: 'Support Orchestrator',
  description: 'Classifies a support request and delegates it to the right specialist(s).',
  instructions:
    'Classify the user request. For application status, delegate to application-specialist. ' +
    'For payment verification, delegate to payment-specialist. For general policy questions, ' +
    'delegate to knowledge-specialist. Combine the specialists\' structured results into one ' +
    'final answer.',
  tools: ['applications.get', 'payments.get', 'knowledge.search'],
  delegation: { delegatesTo: ['application-specialist', 'payment-specialist', 'knowledge-specialist'] },
  model: { provider: 'orchestrator-model', model: 'mock-model' },
});
