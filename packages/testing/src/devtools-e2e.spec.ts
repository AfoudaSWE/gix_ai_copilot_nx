import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createContextEngine, createContextRegistry } from '@gixcopilot/context';
import { createEchoExecutor, createRuntime } from '@gixcopilot/core';
import { contextInspections, createDevTools, memoryTimeline, retrievals, securityDecisions, toolTimeline, traces, flattenTrace, workflow as workflowRecord } from '@gixcopilot/devtools';
import { createDevToolsPlugin } from '@gixcopilot/devtools/server';
import { createMemoryService, createInMemoryMemoryStore } from '@gixcopilot/memory';
import { createModelRuntime } from '@gixcopilot/provider';
import { createActionFirewall, createStaticAuthenticationAdapter } from '@gixcopilot/security';
import { createServer } from '@gixcopilot/server';
import { createRecordingTelemetry, createRetrieverTelemetry, instrumentContextEngine, instrumentMemoryService } from '@gixcopilot/telemetry';
import { createToolRegistry, defineTool } from '@gixcopilot/tools';
import { approvalStep, defineWorkflow, functionStep } from '@gixcopilot/workflows';
import { createKnowledgeFixture } from './knowledge.js';
import { createTestModel } from './model.js';
import { createSecurityFixture } from './security.js';
import { createWorkflowSimulation } from './simulation.js';

/**
 * End-to-end: DevTools reads diagnostics produced by the REAL runtime (server, firewall,
 * context engine, retriever, memory service, workflow engine) and every inspector must agree
 * with what the runtime itself decided (Phase 11 Section 176-185, 229).
 */
const payload = (text: string) => ({ model: { provider: 'test', model: 'test-model' }, messages: [{ role: 'user', content: [{ type: 'text', text }] }] });

function serverTools() {
  const registry = createToolRegistry();
  registry.register(defineTool({ name: 'items.get', description: 'Read an item.', input: z.object({ id: z.string() }), security: { risk: 'read-only' }, execute: ({ id }) => Promise.resolve({ id, status: 'open' }) }));
  registry.register(defineTool({ name: 'items.delete', description: 'Delete an item.', input: z.object({ id: z.string() }), security: { requiredPermissions: ['items.delete'], risk: 'destructive' }, execute: () => Promise.resolve({ deleted: true }) }));
  return registry;
}

const model = () =>
  createModelRuntime({
    providers: [
      createTestModel([
        { when: (turn) => turn.toolResults.length >= 2, respond: { text: 'Item 1 is open; deleting is not permitted.' } },
        { respond: { toolCalls: [{ name: 'items.get', arguments: { id: '1' } }, { name: 'items.delete', arguments: { id: '1' } }] } },
      ]),
    ],
    defaultProvider: 'test',
  });

describe('DevTools against the real server (Section 176, 179-180, 183)', () => {
  let app: ReturnType<typeof createServer> | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('one request is followable through model, tool and firewall by run id, and the security inspector equals the firewall', async () => {
    const telemetry = createRecordingTelemetry({ mode: 'redacted' });
    app = createServer({
      runtime: createRuntime({ executor: createEchoExecutor() }),
      modelRuntime: model(),
      toolRegistry: serverTools(),
      telemetry,
      actionFirewall: createActionFirewall(),
      authenticationAdapter: createStaticAuthenticationAdapter({ viewer: { subject: 'viewer', roles: [], permissions: [], attributes: { tenantId: 'tenant-1' } } }),
    });
    const response = await app.inject({ method: 'POST', url: '/runs', payload: payload('Check item 1 and delete it.'), headers: { authorization: 'Bearer viewer' } });
    expect(response.statusCode).toBe(200);

    const session = createDevTools({ source: telemetry }).getSession();
    const run = session.runs.find((candidate) => candidate.kind === 'copilot');
    expect(run?.status).toBe('completed');
    const runId = run?.runId ?? '';
    for (const type of ['model.call', 'tool.execution', 'security.decision', 'protocol.event'] as const) {
      expect(session.events.some((event) => event.type === type && event.correlation.runId === runId), type).toBe(true);
    }
    // Section 183: what DevTools shows IS the firewall's recorded result, decision by decision.
    const recorded = telemetry.session().events.filter((event) => event.type === 'security.decision');
    expect(securityDecisions(session, runId).map((timeline) => [timeline.action, timeline.decision])).toEqual(recorded.map((event) => (event.type === 'security.decision' ? [event.action, event.decision] : [])));
    expect(toolTimeline(session, runId).find((entry) => entry.name === 'items.delete')?.securityDecision).toBe('deny');
    // The trace nests model and tool work under the run.
    const trace = traces(session).find((candidate) => candidate.rootName === 'copilot.run');
    if (!trace) throw new Error('copilot.run trace missing');
    const names = flattenTrace(trace).map((node) => node.span.name);
    expect(names).toEqual(expect.arrayContaining(['copilot.run', 'model.call', 'tool.execute']));
  });

  it('with DevTools disabled the application still works and exposes no diagnostics endpoint', async () => {
    const telemetry = createRecordingTelemetry({ mode: 'redacted' });
    app = createServer({ runtime: createRuntime({ executor: createEchoExecutor() }), modelRuntime: model(), toolRegistry: serverTools() });
    await app.register(createDevToolsPlugin(createDevTools({ source: telemetry }), { enabled: false }));
    const response = await app.inject({ method: 'POST', url: '/runs', payload: payload('Check item 1.') });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('run.completed');
    expect((await app.inject({ method: 'GET', url: '/devtools/session' })).statusCode).toBe(404);
    expect(telemetry.session().events).toEqual([]); // nothing was wired to record
  });

  it('a standalone DevTools host serves the session only with auth', async () => {
    const telemetry = createRecordingTelemetry();
    const host = Fastify();
    await host.register(createDevToolsPlugin(createDevTools({ source: telemetry }), { enabled: true, authorize: (request) => request.headers.authorization === 'Bearer t' }));
    expect((await host.inject({ method: 'GET', url: '/devtools/session' })).statusCode).toBe(401);
    expect((await host.inject({ method: 'GET', url: '/devtools/session', headers: { authorization: 'Bearer t' } })).statusCode).toBe(200);
    await host.close();
  });
});

describe('inspectors match the runtime (Section 181, 184, 185)', () => {
  it('context inspector: included scopes, exclusions, token counts, priority and truncation equal the engine result', async () => {
    const telemetry = createRecordingTelemetry({ mode: 'redacted' });
    const registry = createContextRegistry();
    registry.register({ id: 'page', name: 'Current page', scope: 'page', value: { route: '/applications/APP-1024' }, priority: 'high' });
    registry.register({ id: 'history', name: 'Long history', scope: 'session', value: 'x '.repeat(4000), priority: 'low' });
    registry.register({ id: 'hr', name: 'employee-records', scope: 'application', value: { salaries: [1, 2] }, sensitivity: 'restricted' });
    const engine = instrumentContextEngine(createContextEngine({ maxContextTokens: 600 }), telemetry, { maxContextTokens: 600 });
    const resolved = await engine.resolve(registry, { correlation: { runId: 'run-ctx' } });

    const [inspection] = contextInspections(createDevTools({ source: telemetry }).getSession(), 'run-ctx');
    expect(inspection?.included.map((item) => [item.id, item.scope, item.priority, item.estimatedTokens, item.truncated])).toEqual(
      resolved.items.map((item) => [item.id, item.scope, item.priority, item.estimatedTokens, item.truncated]),
    );
    expect(inspection?.excluded.map((item) => [item.id, item.reason])).toEqual(resolved.excluded.map((item) => [item.id, item.reason]));
    expect(inspection?.usedTokens).toBe(resolved.items.reduce((sum, item) => sum + item.estimatedTokens, 0));
    expect(inspection?.excluded.some((item) => item.name === 'employee-records')).toBe(true);
  });

  it('RAG inspector: the selected chunks are exactly what the retriever put in the prompt context', async () => {
    const telemetry = createRecordingTelemetry({ mode: 'redacted' });
    const knowledge = await createKnowledgeFixture({
      documents: [
        { id: 'policy', content: 'Applications are approved once identity and payment are verified.' },
        { id: 'faq', content: 'Applicants receive a confirmation email after approval.' },
      ],
      tenantId: 'tenant-a',
    });
    const result = await createRetrieverTelemetry(telemetry).instrument(knowledge.retriever).retrieve({ text: 'approval', topK: 3 }, { securityContext: createSecurityFixture({ tenantId: 'tenant-a' }).securityContext });
    const [inspection] = retrievals(createDevTools({ source: telemetry }).getSession());
    expect(inspection?.candidates.filter((candidate) => candidate.selected).map((candidate) => candidate.chunkId)).toEqual(result.items.map((item) => item.item.chunk.id));
    expect(inspection?.candidates.filter((candidate) => candidate.citationId).map((candidate) => candidate.citationId)).toEqual(result.citations.map((citation) => citation.id));
  });

  it('memory inspector: a viewer sees only their own tenant and their own memory', async () => {
    const telemetry = createRecordingTelemetry({ mode: 'redacted' });
    const store = createInMemoryMemoryStore();
    for (const [subject, tenantId] of [['user-1', 'tenant-a'], ['user-2', 'tenant-a'], ['user-9', 'tenant-b']] as const) {
      const securityContext = createSecurityFixture({ subject, tenantId }).securityContext;
      const service = instrumentMemoryService(createMemoryService({ store, securityContext, persistence: 'application-policy' }), telemetry, { correlation: { runId: `run-${subject}`, tenantId } });
      await service.save({ type: 'durable', value: `${subject} prefers email`, provenance: 'explicit-user-save' }, true);
      await service.search({ topK: 5 });
    }
    const view = memoryTimeline(createDevTools({ source: telemetry }).getSession({ tenantId: 'tenant-a', subject: 'user-1' }));
    expect(new Set(view.map((entry) => entry.ownerId))).toEqual(new Set(['user-1']));
    expect(JSON.stringify(view)).not.toContain('user-9');
  });
});

describe('workflow trace coherence across pause and resume (Section 178)', () => {
  it('one workflow run id links the pause, the approval wait and the resume', async () => {
    const State = z.object({ ok: z.boolean() });
    type State = z.infer<typeof State>;
    const definition = defineWorkflow({
      id: 'review',
      version: '3',
      state: State,
      initialState: () => ({ ok: false }),
      steps: [
        functionStep<State>({ id: 'prepare', run: ({ state }) => ({ ...state, ok: true }) }),
        approvalStep<State>({ id: 'approve', dependencies: ['prepare'], action: 'review.approve', summary: () => 'Approve the review' }),
      ],
    });
    const security = createSecurityFixture({ subject: 'u', tenantId: 'tenant-a' });
    const simulation = createWorkflowSimulation({ workflows: [definition], security });
    const started = await simulation.engine.start({ workflowId: 'review', input: {}, securityContext: security.securityContext });
    await simulation.approvals.decideOnly(started.workflowRunId, 'approve', 'reviewer-1');
    await simulation.restart().resume(started.workflowRunId, { securityContext: security.securityContext });

    const session = simulation.devtools.getSession({ tenantId: 'tenant-a' });
    const record = workflowRecord(session, started.workflowRunId);
    expect(record).toMatchObject({ status: 'completed', version: '3', pauses: [expect.objectContaining({ reason: 'approval', stepId: 'approve' })] });
    const wait = session.spans.find((span) => span.name === 'approval.wait');
    expect(wait?.correlation.runId).toBe(started.workflowRunId);
    expect(session.spans.filter((span) => span.name === 'workflow.run').every((span) => span.correlation.runId === started.workflowRunId)).toBe(true);
  });
});
