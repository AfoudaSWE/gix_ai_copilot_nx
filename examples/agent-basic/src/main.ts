import { createAgentRegistry, createAgentRuntime } from '@gixcopilot/agents';
import type { CopilotEvent } from '@gixcopilot/protocol';
import { createModelRuntime } from '@gixcopilot/provider';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';
import { createStaticToolResolver, createToolRuntime } from '@gixcopilot/tools';
import { createPermissionAwareToolResolver } from '@gixcopilot/security';
import type { SecurityContext } from '@gixcopilot/security';
import { applicationAgent } from './agent.js';
import { createExampleKnowledgeBase } from './knowledge.js';
import { createExampleMemoryStore, createKnowledgeSearchTool, createMemoryTools, getApplicationTool } from './tools.js';

function printAgentEvent(event: CopilotEvent): void {
  switch (event.type) {
    case 'agent.run.started':
      console.log(`[agent] ${event.agentId} started (run ${event.agentRunId})`);
      break;
    case 'agent.run.completed':
      console.log(`[agent] ${event.agentId} completed`);
      break;
    case 'agent.run.failed':
      console.log(`[agent] ${event.agentId} failed: ${event.error.code}`);
      break;
    case 'agent.run.cancelled':
      console.log(`[agent] ${event.agentId} cancelled`);
      break;
    // This demo only prints agent-lifecycle events - every other event type (message/tool/
    // approval/delegation/handoff/workflow) is intentionally silent here.
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
    case 'agent.delegation.started':
    case 'agent.delegation.completed':
    case 'agent.handoff':
    case 'agent.routing.decided':
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
  const providerId = process.env['MODEL_PROVIDER'] ?? 'mock';
  const openaiApiKey = process.env['OPENAI_API_KEY'];
  const usingOpenAI = providerId === 'openai' && Boolean(openaiApiKey);
  const modelName = usingOpenAI ? (process.env['MODEL_NAME'] ?? 'gpt-4o-mini') : 'mock-model';

  const { vectorStore, embeddingProvider } = await createExampleKnowledgeBase();
  const memoryStore = createExampleMemoryStore();
  const knowledgeSearchTool = createKnowledgeSearchTool(vectorStore, embeddingProvider);
  const memoryTools = createMemoryTools(memoryStore);

  const registry = createAgentRegistry();
  registry.register(applicationAgent);

  // A real, trusted user identity - never taken from model/tool input (Section 59, 185).
  const securityContext: SecurityContext = {
    tenant: { tenantId: 'demo' },
    identity: { subject: 'user-1', roles: ['viewer'], permissions: [] },
  };

  const baseResolver = createStaticToolResolver([
    getApplicationTool,
    knowledgeSearchTool,
    memoryTools.recall,
    memoryTools.save,
  ]);
  // Discovery is already permission-filtered for the trusted user (Section 34) - none of
  // this demo's tools require a special permission, so every one of them stays visible to
  // this viewer identity; a real deployment would gate consequential tools the same way
  // `examples/react-enterprise` does.
  const toolResolver = createPermissionAwareToolResolver(baseResolver, securityContext.identity);
  const toolRuntime = createToolRuntime({ resolver: toolResolver });

  const modelRuntime = createModelRuntime({
    providers: [
      createMockProvider({
        id: 'mock',
        scenario: (attempt) =>
          attempt === 1
            ? { toolCalls: [{ id: 'call-1', name: 'applications.get', arguments: { id: 'APP-1024' } }] }
            : attempt === 2
              ? { toolCalls: [{ id: 'call-2', name: 'knowledge.search', arguments: { query: 'application approval policy' } }] }
              : { chunks: ['APP-1024 is currently under review for Jordan Miles. It will be approved once identity and payment verification are complete.'] },
      }),
      ...(openaiApiKey ? [createOpenAIProvider({ apiKey: openaiApiKey })] : []),
    ],
    defaultProvider: usingOpenAI ? 'openai' : 'mock',
    defaultModel: modelName,
  });

  const runtime = createAgentRuntime({ registry, modelRuntime, toolRuntime, toolResolver });

  console.log(`Provider: ${usingOpenAI ? 'openai' : 'mock'}`);
  console.log(`Model: ${modelName}\n`);
  console.log('> Check APP-1024 and explain its current status.\n');

  const result = await runtime.run({
    agent: 'application',
    input: { message: 'Check APP-1024 and explain its current status.' },
    securityContext,
    onEvent: printAgentEvent,
  });

  console.log(`\nStatus: ${result.status}`);
  if (result.status === 'completed') console.log(`Answer: ${String(result.output)}`);
  if (result.status === 'failed') console.log(`Error: ${result.error?.code} - ${result.error?.message}`);
}

main().catch((error: unknown) => {
  console.error('Fatal error running the agent-basic demo:', error);
  process.exitCode = 1;
});
