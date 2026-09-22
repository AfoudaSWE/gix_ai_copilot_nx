import { defineAgent } from '@gixcopilot/agents';

/**
 * A single declarative agent (Section 9-10, 166, 170): instructions, model, a narrow tool
 * allowlist, one knowledge source, and one memory type - never "every registered tool"
 * implicitly (Section 53).
 */
export const applicationAgent = defineAgent({
  id: 'application',
  name: 'Application Support Agent',
  description: 'Answers questions about a specific application, using real tools and knowledge.',
  instructions:
    'You help users check the status of their applications. Use applications.get for a ' +
    'specific application id. Use knowledge.search for general policy questions. Use ' +
    'memory.recall to check what you already know about this user, and memory.save only ' +
    'when the user shares a durable preference or fact worth remembering. Never claim a fact ' +
    'you did not retrieve from a tool.',
  tools: ['applications.get', 'knowledge.search', 'memory.recall', 'memory.save'],
  knowledge: { sources: ['application-policy'] },
  memory: { types: ['durable'] },
  limits: { maxIterations: 6, maxToolCalls: 8 },
});
