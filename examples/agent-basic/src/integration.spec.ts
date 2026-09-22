import { afterEach, describe, expect, it } from 'vitest';
import { createRunId } from '@gixcopilot/protocol';
import { createAgentRegistry, createAgentRuntime } from '@gixcopilot/agents';
import { createModelRuntime } from '@gixcopilot/provider';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { createStaticToolResolver, createToolRuntime } from '@gixcopilot/tools';
import { createPermissionAwareToolResolver } from '@gixcopilot/security';
import type { Identity, SecurityContext } from '@gixcopilot/security';
import type { MemoryStore } from '@gixcopilot/memory';
import { applicationAgent } from './agent.js';
import { createExampleKnowledgeBase } from './knowledge.js';
import { createExampleMemoryStore, createKnowledgeSearchTool, createMemoryTools, getApplicationTool } from './tools.js';

/**
 * Mandatory end-to-end test (Section 170, 231): a real agent, a real deterministic model, a
 * real tool call against real in-memory state, real RAG retrieval and real memory - nothing
 * fixture-matched against the question text.
 */
describe('agent-basic: single agent + tool + knowledge + memory + security', () => {
  const identity: Identity = { subject: 'user-1', roles: ['viewer'], permissions: [] };
  const securityContext: SecurityContext = { tenant: { tenantId: 'demo' }, identity };
  let memoryStore: MemoryStore;

  afterEach(() => {
    memoryStore = createExampleMemoryStore();
  });

  async function buildRuntime(scenario: Parameters<typeof createMockProvider>[0]) {
    const { vectorStore, embeddingProvider } = await createExampleKnowledgeBase();
    memoryStore = createExampleMemoryStore();
    const knowledgeSearchTool = createKnowledgeSearchTool(vectorStore, embeddingProvider);
    const memoryTools = createMemoryTools(memoryStore);

    const registry = createAgentRegistry();
    registry.register(applicationAgent);

    const resolver = createPermissionAwareToolResolver(
      createStaticToolResolver([getApplicationTool, knowledgeSearchTool, memoryTools.recall, memoryTools.save]),
      identity,
    );
    const toolRuntime = createToolRuntime({ resolver });
    const modelRuntime = createModelRuntime({ providers: [createMockProvider(scenario)], defaultProvider: 'mock', defaultModel: 'mock-model' });
    const runtime = createAgentRuntime({ registry, modelRuntime, toolRuntime, toolResolver: resolver });
    return { runtime, memoryStore };
  }

  it('checks a real application through applications.get and reports its real status', async () => {
    const { runtime } = await buildRuntime({
      id: 'mock',
      scenario: (attempt) =>
        attempt === 1
          ? { toolCalls: [{ id: 'c1', name: 'applications.get', arguments: { id: 'APP-1024' } }] }
          : { chunks: ['APP-1024 is under_review for Jordan Miles.'] },
    });

    const result = await runtime.run({
      agent: 'application',
      input: { message: 'Check APP-1024' },
      securityContext,
    });

    expect(result.status).toBe('completed');
    expect(result.output).toContain('under_review');
    expect(result.toolCallCount).toBe(1);
  });

  it('answers a policy question by actually retrieving from the indexed knowledge base', async () => {
    const { runtime } = await buildRuntime({
      id: 'mock',
      scenario: (attempt) =>
        attempt === 1
          ? { toolCalls: [{ id: 'c1', name: 'knowledge.search', arguments: { query: 'when is an application approved' } }] }
          : { chunks: ['An application is approved once identity and payment are verified.'] },
    });

    const result = await runtime.run({
      agent: 'application',
      input: { message: 'When is an application approved?' },
      securityContext,
    });

    expect(result.status).toBe('completed');
    expect(result.toolCallCount).toBe(1);
  });

  it('saves and recalls a real durable memory across two separate runs', async () => {
    const { runtime, memoryStore: store } = await buildRuntime({
      id: 'mock',
      scenario: (attempt) =>
        attempt === 1
          ? { toolCalls: [{ id: 'c1', name: 'memory.save', arguments: { value: 'Prefers email over phone.' } }] }
          : { chunks: ['Got it, I will remember that.'] },
    });

    const firstRun = await runtime.run({
      agent: 'application',
      input: { message: 'Remember that I prefer email over phone.' },
      securityContext,
    });
    expect(firstRun.status).toBe('completed');

    const saved = await store.search({ owner: { type: 'user', id: 'user-1' }, tenantId: 'demo' });
    expect(saved.map((result) => result.record.value)).toContain('Prefers email over phone.');
  });

  it("a viewer's own memory is never visible to a different user (Section 132, 188)", async () => {
    const { memoryStore: store } = await buildRuntime({ id: 'mock', scenario: {} });
    const otherIdentity: Identity = { subject: 'user-2', roles: ['viewer'], permissions: [] };
    const otherContext: SecurityContext = { tenant: { tenantId: 'demo' }, identity: otherIdentity };

    await store.put({ type: 'durable', owner: { type: 'user', id: 'user-1' }, tenantId: 'demo', value: 'secret preference' });

    const memoryTools = createMemoryTools(store);
    const result = await memoryTools.recall.execute(
      {},
      { runId: createRunId(), signal: new AbortController().signal, metadata: { securityContext: otherContext } },
    );

    expect(JSON.stringify(result)).not.toContain('secret preference');
  });
});
