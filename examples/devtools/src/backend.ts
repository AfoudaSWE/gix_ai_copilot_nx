import { z } from 'zod';
import { createAgentRegistry, createAgentRuntime, defineAgent } from '@gixcopilot/agents';
import { createContextEngine, createContextRegistry, createCopilotStateStore } from '@gixcopilot/context';
import { createEchoExecutor, createRuntime } from '@gixcopilot/core';
import { createDevTools } from '@gixcopilot/devtools';
import type { DevToolsRecorder } from '@gixcopilot/devtools';
import { createDevToolsPlugin } from '@gixcopilot/devtools/server';
import { textLoader, textSource } from '@gixcopilot/knowledge';
import { createInMemoryMemoryStore, createMemoryService, createPermissiveMemoryWritePolicy } from '@gixcopilot/memory';
import { createModelRuntime } from '@gixcopilot/provider';
import type { ModelProvider, ModelRuntime } from '@gixcopilot/provider';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';
import { createDeterministicEmbeddingProvider, createIndexer, createInMemoryVectorStore, createOpenAIEmbeddingProvider, createRecursiveChunker, createRetriever } from '@gixcopilot/rag';
import {
  createActionFirewall,
  createActionFirewallMiddleware,
  createInMemoryApprovalStore,
  createPermissionAwareToolResolver,
  createStaticAuthenticationAdapter,
} from '@gixcopilot/security';
import type { Identity, SecurityContext } from '@gixcopilot/security';
import { createServer } from '@gixcopilot/server';
import {
  createFirewallTelemetry,
  createRecordingTelemetry,
  createRetrieverTelemetry,
  createToolTelemetry,
  instrumentApprovalStore,
  instrumentContextEngine,
  instrumentMemoryService,
  instrumentModelRuntime,
  observeStateStore,
  withTelemetryMetadata,
} from '@gixcopilot/telemetry';
import type { RecordingTelemetry } from '@gixcopilot/telemetry';
import { createToolRegistry, createToolRuntime, defineTool } from '@gixcopilot/tools';
import type { AnyToolDefinition, ToolExecutionContext } from '@gixcopilot/tools';
import { approvalStep, createInMemoryCheckpointStore, createWorkflowEngine, defineWorkflow, functionStep, toolStep } from '@gixcopilot/workflows';
import { createDemoModels } from './models.js';

/** Demonstration credentials only - replace with the host application's session adapter. */
export const IDENTITIES: Readonly<Record<string, Identity>> = {
  applicant: { subject: 'user-1', roles: ['applicant'], permissions: ['applications.view'], attributes: { tenantId: 'tenant-a' } },
  officer: { subject: 'officer-1', roles: ['officer'], permissions: ['applications.view', 'applications.write'], attributes: { tenantId: 'tenant-a' } },
  supervisor: { subject: 'supervisor-1', roles: ['supervisor'], permissions: ['approvals.supervisor'], attributes: { tenantId: 'tenant-a' } },
};

const APPLICATIONS = new Map([['APP-1024', { tenantId: 'tenant-a', status: 'under_review', assignee: 'Officer A', applicant: 'user-1' }]]);
const PAYMENTS = new Map([['user-1', { method: 'card', verified: true }]]);

export interface DevToolsDemoOptions {
  /** Real OpenAI for chat, agents and embeddings; otherwise deterministic scripted models. */
  readonly live?: { readonly apiKey: string; readonly model: string; readonly embeddingModel?: string };
  /** DevTools is opt-in (Section 25). With `enabled: false` the app runs unchanged. */
  readonly devtools?: { readonly enabled: boolean; readonly token?: string };
}

export interface DevToolsDemo {
  readonly app: ReturnType<typeof createServer>;
  readonly telemetry: RecordingTelemetry;
  readonly devtools: DevToolsRecorder;
}

const tenantOf = (identity: Identity): string => {
  const tenantId = identity.attributes?.['tenantId'];
  return typeof tenantId === 'string' ? tenantId : '';
};
const contextOf = (identity: Identity): SecurityContext => ({ identity, tenant: { tenantId: tenantOf(identity) } });

function trusted(context: ToolExecutionContext): SecurityContext {
  const securityContext = (context.metadata as { securityContext?: SecurityContext } | undefined)?.securityContext;
  if (!securityContext?.identity) throw new Error('A trusted security context is required.');
  return securityContext;
}

/**
 * One application whose chat, tools, firewall, approvals, generative UI, RAG, memory, agents,
 * workflow, context and state all record into ONE telemetry session - which DevTools then
 * inspects (Section 206, 219). DevTools is observation only: remove it and nothing here changes.
 */
export async function createDevToolsDemo(options: DevToolsDemoOptions = {}): Promise<DevToolsDemo> {
  const telemetry = createRecordingTelemetry({ mode: 'redacted', capacity: 20_000 });
  const devtools = createDevTools({ source: telemetry });

  // ---- Knowledge + memory (Phase 9), instrumented.
  const vectorStore = createInMemoryVectorStore();
  const embeddingProvider = options.live ? createOpenAIEmbeddingProvider({ apiKey: options.live.apiKey, model: options.live.embeddingModel ?? 'text-embedding-3-small' }) : createDeterministicEmbeddingProvider();
  const indexer = createIndexer({ vectorStore, embeddingProvider, chunker: createRecursiveChunker({ chunkSize: 600, chunkOverlap: 40 }) });
  await indexer.index({ source: textSource({ id: 'application-policy', name: 'Application Review Policy', tenantId: 'tenant-a', content: 'An application is approved once a reviewer confirms the identity documents and verifies the payment method.' }), loader: textLoader });
  await indexer.index({ source: textSource({ id: 'hr-compensation', name: 'Reviewer Compensation', tenantId: 'tenant-a', permissions: ['hr.read'], content: 'Confidential reviewer salary bands and the bonus pool.' }), loader: textLoader });
  const retriever = createRetrieverTelemetry(telemetry).instrument(createRetriever({ vectorStore, embeddingProvider }));
  const memoryStore = createInMemoryMemoryStore({ writePolicy: createPermissiveMemoryWritePolicy() });
  await memoryStore.put({ type: 'durable', owner: { type: 'user', id: 'user-1' }, tenantId: 'tenant-a', value: 'Prefers email updates.', provenance: 'explicit-user-save' });

  // ---- Tools (Phase 5), with real Phase 7 security metadata.
  const correlation = (context: ToolExecutionContext) => ({ runId: context.runId, tenantId: trusted(context).tenant?.tenantId });
  const tools: AnyToolDefinition[] = [
    defineTool({
      name: 'applications.get',
      description: 'Read an application.',
      input: z.object({ id: z.string() }),
      security: { requiredPermissions: ['applications.view'], risk: 'read-only' },
      execute: ({ id }, context) => {
        const record = APPLICATIONS.get(id);
        return Promise.resolve(record && record.tenantId === trusted(context).tenant?.tenantId ? { id, status: record.status, assignee: record.assignee } : { found: false });
      },
    }),
    defineTool({
      name: 'applications.reassign',
      description: 'Reassign an application - requires supervisor approval.',
      input: z.object({ id: z.string(), assignee: z.string() }),
      security: { requiredPermissions: ['applications.write'], risk: 'write', approval: 'supervisor' },
      execute: ({ id, assignee }) => {
        const record = APPLICATIONS.get(id);
        if (record) APPLICATIONS.set(id, { ...record, assignee });
        return Promise.resolve({ id, assignee });
      },
    }),
    defineTool({
      name: 'applications.delete',
      description: 'Delete an application.',
      input: z.object({ id: z.string() }),
      security: { requiredPermissions: ['applications.delete'], risk: 'destructive' },
      execute: ({ id }) => Promise.resolve({ deleted: id }),
    }),
    defineTool({
      name: 'ui.render.applicationCard',
      description: 'Render the trusted ApplicationCard component (Phase 6 generative UI).',
      input: z.object({ id: z.string(), status: z.string() }),
      security: { risk: 'read-only' },
      execute: (props) => Promise.resolve({ component: 'ApplicationCard', props }),
    }),
    defineTool({
      name: 'payments.get',
      description: "The current user's payment verification.",
      input: z.object({}),
      security: { risk: 'read-only' },
      execute: (_input, context) => Promise.resolve(PAYMENTS.get(trusted(context).identity?.subject ?? '') ?? { found: false }),
    }),
    defineTool({
      name: 'knowledge.search',
      description: 'Search the policy knowledge base.',
      input: z.object({ query: z.string() }),
      security: { risk: 'read-only' },
      execute: async ({ query }, context) => {
        const result = await retriever.retrieve({ text: query, topK: 3, threshold: options.live ? 0.3 : 0 }, { securityContext: trusted(context), signal: context.signal, telemetry: withTelemetryMetadata(undefined, { correlation: correlation(context) }) } as Parameters<typeof retriever.retrieve>[1]);
        return { results: result.items.map((item) => ({ citation: item.citationId, source: item.item.provenance.sourceId, text: item.item.chunk.content })) };
      },
    }),
    defineTool({
      name: 'memory.recall',
      description: "Search the current user's own memory.",
      input: z.object({}),
      security: { risk: 'read-only' },
      execute: async (_input, context) => {
        const service = instrumentMemoryService(createMemoryService({ store: memoryStore, securityContext: trusted(context) }), telemetry, { correlation: correlation(context) });
        return { memories: (await service.search({ topK: 5 })).map((result) => result.record.value) };
      },
    }),
  ] as AnyToolDefinition[];

  // ---- Models (Phase 2): deterministic scripted by default, real OpenAI when configured.
  const providers: ModelProvider[] = options.live ? [createOpenAIProvider({ apiKey: options.live.apiKey })] : createDemoModels();
  const modelRuntime: ModelRuntime = createModelRuntime({ providers, defaultProvider: options.live ? 'openai' : 'chat-model', defaultModel: options.live?.model ?? 'test-model' });

  // ---- The copilot server (Phase 1-7) - telemetry wired in, exactly one argument.
  const registry = createToolRegistry();
  for (const tool of tools) registry.register(tool);
  const approvals = createInMemoryApprovalStore();
  const firewall = createActionFirewall();
  const app = createServer({
    runtime: createRuntime({ executor: createEchoExecutor() }),
    modelRuntime,
    toolRegistry: registry,
    telemetry,
    actionFirewall: firewall,
    approvals,
    authenticationAdapter: createStaticAuthenticationAdapter(IDENTITIES),
    approvalExpiresInMs: 10 * 60_000,
  });

  // ---- Agents (Phase 10): an orchestrator with three specialists.
  const agentRegistry = createAgentRegistry();
  const agentModel = (provider: string) => ({ provider: options.live ? 'openai' : provider, model: options.live?.model ?? 'test-model' });
  agentRegistry.register(defineAgent({ id: 'orchestrator', name: 'Orchestrator', instructions: 'Delegate each part of the request to the right specialist and combine their answers.', tools: ['applications.get', 'payments.get', 'knowledge.search', 'memory.recall'], knowledge: { sources: ['application-policy'] }, memory: { types: ['durable'] }, delegation: { delegatesTo: ['application', 'payment', 'knowledge'] }, model: agentModel('orchestrator-model') }));
  agentRegistry.register(defineAgent({ id: 'application', name: 'Application Specialist', instructions: 'Answer about applications with applications.get.', tools: ['applications.get'], model: agentModel('application-model'), metadata: { version: '2' } }));
  agentRegistry.register(defineAgent({ id: 'payment', name: 'Payment Specialist', instructions: 'Answer about payment verification with payments.get.', tools: ['payments.get'], model: agentModel('payment-model') }));
  agentRegistry.register(defineAgent({ id: 'knowledge', name: 'Knowledge Specialist', instructions: 'Answer policy questions with knowledge.search and memory.recall, citing [S1].', tools: ['knowledge.search', 'memory.recall'], knowledge: { sources: ['application-policy'] }, model: agentModel('knowledge-model') }));

  const agentStack = (identity: Identity) => {
    const securityContext = contextOf(identity);
    const resolver = createPermissionAwareToolResolver({ resolve: () => Promise.resolve(tools) }, identity);
    const toolTelemetry = createToolTelemetry(telemetry);
    const instrumented = createFirewallTelemetry(telemetry, { tracker: toolTelemetry.tracker }).instrument(firewall);
    const correlatedFirewall = { ...instrumented, evaluate: (request: Parameters<typeof firewall.evaluate>[0], context: SecurityContext) => instrumented.evaluate(request, { ...context, metadata: withTelemetryMetadata(context.metadata, { correlation: { runId: request.runId, tenantId: securityContext.tenant?.tenantId } }) }) };
    const toolRuntime = toolTelemetry.instrument(
      createToolRuntime({ resolver, middleware: [createActionFirewallMiddleware({ firewall: correlatedFirewall, resolver, getContext: () => securityContext }), toolTelemetry.middleware], onEvent: (event) => toolTelemetry.onEvent(event) }),
    );
    const traced = instrumentModelRuntime(modelRuntime, telemetry);
    return { securityContext, runtime: createAgentRuntime({ registry: agentRegistry, modelRuntime: { registry: modelRuntime.registry, stream: traced.stream.bind(traced) }, toolRuntime, toolResolver: resolver, telemetry }), toolRuntime };
  };

  // ---- Workflow (Phase 10): validate -> read -> supervisor approval -> reassign.
  const State = z.object({ id: z.string(), valid: z.boolean(), reassigned: z.boolean() });
  type State = z.infer<typeof State>;
  const workflow = defineWorkflow({
    id: 'application-reassignment',
    version: '1',
    input: z.object({ id: z.string() }),
    state: State,
    initialState: ({ id }) => ({ id, valid: false, reassigned: false }),
    steps: [
      functionStep<State>({ id: 'validate', run: ({ state }) => ({ ...state, valid: APPLICATIONS.has(state.id) }) }),
      toolStep<State>({ id: 'read', dependencies: ['validate'], tool: 'applications.get', input: ({ state }) => ({ id: state.id }), updateState: (state) => state }),
      approvalStep<State>({ id: 'supervisor-approval', dependencies: ['read'], action: 'applications.reassign', summary: ({ state }) => `Reassign ${state.id} to Officer B` }),
      functionStep<State>({ id: 'reassign', dependencies: ['supervisor-approval'], run: ({ state }) => ({ ...state, reassigned: true }) }),
    ],
  });
  const workflowApprovals = instrumentApprovalStore(createInMemoryApprovalStore(), telemetry);
  // One durable checkpoint store shared by every engine instance (Phase 10: resume anywhere).
  const checkpointStore = createInMemoryCheckpointStore();
  const engineFor = (identity: Identity) => {
    const engine = createWorkflowEngine({ telemetry, checkpointStore, toolRuntime: agentStack(identity).toolRuntime, approvals: workflowApprovals });
    engine.register(workflow);
    return engine;
  };

  // ---- Context + shared state (Phase 4/6), instrumented.
  const contextRegistry = createContextRegistry();
  contextRegistry.register({ id: 'page', name: 'Current page', scope: 'page', value: { route: '/applications/APP-1024' }, priority: 'high' });
  contextRegistry.register({ id: 'user-profile', name: 'User profile', scope: 'user', value: { locale: 'en', tier: 'standard' } });
  contextRegistry.register({ id: 'employee-records', name: 'employee-records', scope: 'application', value: { salaries: 'restricted' }, sensitivity: 'restricted' });
  const contextEngine = instrumentContextEngine(createContextEngine({ maxContextTokens: 2_000 }), telemetry, { maxContextTokens: 2_000 });
  const stateStore = observeStateStore(createCopilotStateStore(), telemetry, { correlation: { threadId: 'demo-thread', tenantId: 'tenant-a' } });
  stateStore.register({ id: 'filters', name: 'Dashboard filters', initialValue: { status: 'all' }, modelWritable: true });

  const identityOf = async (authorization: string | undefined): Promise<Identity | null> =>
    createStaticAuthenticationAdapter(IDENTITIES).authenticate({ headers: { authorization } });

  app.post<{ Body: { message: string } }>('/agents/ask', async (request, reply) => {
    const identity = await identityOf(request.headers.authorization);
    if (!identity) return reply.status(401).send({ error: 'Unauthorized' });
    const { runtime, securityContext } = agentStack(identity);
    const result = await runtime.run({ agent: 'orchestrator', input: { message: request.body.message }, securityContext, threadId: 'demo-thread' });
    return { status: result.status, output: result.status === 'completed' ? result.output : undefined, runId: result.runId };
  });
  app.post<{ Body: { id: string } }>('/workflows/reassignment', async (request, reply) => {
    const identity = await identityOf(request.headers.authorization);
    if (!identity) return reply.status(401).send({ error: 'Unauthorized' });
    const checkpoint = await engineFor(identity).start({ workflowId: 'application-reassignment', input: { id: request.body.id }, securityContext: contextOf(identity) });
    return { workflowRunId: checkpoint.workflowRunId, status: checkpoint.status, approvalId: checkpoint.pendingApproval?.approvalId };
  });
  app.post<{ Params: { workflowRunId: string; approvalId: string } }>('/workflows/:workflowRunId/approvals/:approvalId/approve', async (request, reply) => {
    const identity = await identityOf(request.headers.authorization);
    if (!identity?.permissions.includes('approvals.supervisor')) return reply.status(403).send({ error: 'Only a supervisor can approve.' });
    await workflowApprovals.approve(request.params.approvalId, identity.subject);
    const checkpoint = await engineFor(identity).resume(request.params.workflowRunId, { securityContext: contextOf(identity) });
    return { status: checkpoint.status };
  });
  app.post('/context/resolve', async () => {
    const resolved = await contextEngine.resolve(contextRegistry, { correlation: { threadId: 'demo-thread', tenantId: 'tenant-a' } });
    return { items: resolved.items.map((item) => item.name), excluded: resolved.excluded.map((item) => item.name) };
  });
  app.post<{ Body: { status: string; baseRevision: number } }>('/state/filters', (request) =>
    stateStore.applyPatch('filters', { op: 'set', value: { status: request.body.status } }, request.body.baseRevision),
  );

  // ---- DevTools (Phase 11): opt-in, token-protected, read-only.
  await app.register(
    createDevToolsPlugin(devtools, {
      enabled: options.devtools?.enabled ?? false,
      authorize: (request) => Boolean(options.devtools?.token) && request.headers.authorization === `Bearer ${options.devtools?.token ?? ''}`,
      resolveViewer: (request) => ({ tenantId: typeof request.headers['x-devtools-tenant'] === 'string' ? request.headers['x-devtools-tenant'] : undefined }),
    }),
  );
  return { app, telemetry, devtools };
}
