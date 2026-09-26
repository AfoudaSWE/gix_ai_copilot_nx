import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agentTree,
  contextInspections,
  conversation,
  delegations,
  firewallTimeline,
  flattenTrace,
  generativeUiRequests,
  importBundle,
  reconstructState,
  retrievals,
  stateTimeline,
  toolTimeline,
  traces,
  workflows,
} from '@gixcopilot/devtools';
import type { DevToolsSession } from '@gixcopilot/devtools';
import { createDevToolsDemo } from './backend.js';
import type { DevToolsDemo } from './backend.js';
import { runScenario } from './scenario.js';
import type { ScenarioResult } from './scenario.js';

const TOKEN = 'test-devtools-token';
let demo: DevToolsDemo;
let scenario: ScenarioResult;
let session: DevToolsSession;

beforeAll(async () => {
  demo = await createDevToolsDemo({ devtools: { enabled: true, token: TOKEN } });
  scenario = await runScenario(demo);
  const response = await demo.app.inject({ method: 'GET', url: '/devtools/session', headers: { authorization: `Bearer ${TOKEN}` } });
  expect(response.statusCode).toBe(200);
  session = response.json<DevToolsSession>();
});

afterAll(async () => {
  await demo.app.close();
});

describe('the scenario itself ran for real', () => {
  it('chat, denial, agents and workflow all completed', () => {
    expect(scenario.chatBody).toContain('run.completed');
    expect(scenario.chatBody).toContain('approval.approved');
    expect(scenario.deniedBody).toContain('PERMISSION_DENIED');
    expect(scenario.agentStatus).toBe('completed');
    expect(scenario.workflowStatus).toBe('completed');
  });
});

describe('Section 219 - one request followed end to end from one correlated view', () => {
  it('thread -> run -> model -> tools -> firewall -> approval -> result -> generative UI -> response', () => {
    const chatRun = session.runs.find((run) => run.kind === 'copilot' && run.toolCallCount >= 3);
    expect(chatRun?.status).toBe('completed');
    const runId = chatRun?.runId ?? '';
    const entries = conversation(session, runId);
    expect(entries.filter((entry) => entry.kind === 'tool').map((entry) => (entry.kind === 'tool' ? entry.tool.name : ''))).toEqual(['applications.get', 'ui.render.applicationCard', 'applications.reassign']);
    expect(entries.some((entry) => entry.kind === 'approval')).toBe(true);
    // The server streams one assistant message that opens with the run and closes at the end.
    expect(entries.find((entry) => entry.kind === 'message')).toMatchObject({ kind: 'message', message: { text: 'APP-1024 is under review and is now assigned to Officer B.' } });
    const reassign = toolTimeline(session, runId).find((entry) => entry.name === 'applications.reassign');
    expect(reassign).toMatchObject({ status: 'succeeded' });
    expect(generativeUiRequests(session)).toEqual([expect.objectContaining({ component: 'applicationCard', status: 'validated' })]);
    expect(session.modelCalls.filter((call) => call.correlation.runId === runId).length).toBeGreaterThanOrEqual(2);
  });
});

describe('Section 220 - multi-agent inspection', () => {
  it('why each agent ran, its model, visible tools, tool calls, tokens, latency and result', () => {
    const [root] = agentTree(session);
    expect(root).toMatchObject({ agentId: 'orchestrator', status: 'completed', selection: { via: 'root' } });
    const children = new Map((root?.children ?? []).map((child) => [child.agentId, child]));
    expect([...children.keys()].sort()).toEqual(['application', 'knowledge', 'payment']);
    for (const child of children.values()) {
      expect(child.selection).toMatchObject({ via: 'delegation', fromAgentId: 'orchestrator' });
      expect(child.model?.provider).toBeDefined();
      expect(child.usage?.totalTokens).toBeGreaterThan(0);
      expect(child.latencyMs).toBeGreaterThanOrEqual(0);
    }
    expect(children.get('payment')?.visibleTools).toEqual(['payments.get']);
    expect(children.get('knowledge')?.knowledgeSources).toEqual(['application-policy']);
    expect(children.get('application')?.toolsCalled).toEqual([{ name: 'applications.get', status: 'succeeded', securityDecision: 'allow' }]);
    expect(children.get('application')?.version).toBe('2');
    expect(delegations(session).every((record) => record.status === 'completed' && record.childRunId !== undefined)).toBe(true);
  });
});

describe('Section 221 - security inspection', () => {
  it('shows the recorded firewall trail: identity, role, tenant, approval level, final state', () => {
    const decisions = session.security.filter((decision) => decision.action === 'applications.reassign');
    const [first] = decisions;
    if (!first) throw new Error('no reassign decision');
    const waiting = firewallTimeline(first);
    expect(waiting).toMatchObject({ action: 'applications.reassign', subject: 'officer-1', roles: ['officer'], tenantId: 'tenant-a', approvalLevel: 'supervisor', final: 'WAITING_FOR_APPROVAL' });
    const deleted = session.security.find((decision) => decision.action === 'applications.delete');
    expect(deleted ? firewallTimeline(deleted) : undefined).toMatchObject({ final: 'DENIED', reasonCode: 'PERMISSION_DENIED', subject: 'user-1' });
    const approval = session.approvals.find((entry) => entry.action.length > 0 && entry.status === 'approved' && entry.decidedBy === 'supervisor-1');
    expect(approval).toBeDefined();
  });
});

describe('Section 222 - RAG inspection', () => {
  it('why the model received a chunk: score, selection, citation', () => {
    const [retrieval] = retrievals(session);
    const selected = retrieval?.candidates.find((candidate) => candidate.selected);
    expect(selected).toMatchObject({ sourceId: 'application-policy', citationId: 'S1' });
    expect(typeof selected?.score).toBe('number');
    expect(retrieval?.candidates.some((candidate) => candidate.sourceId === 'hr-compensation')).toBe(false);
  });
});

describe('context, state, workflow and traces', () => {
  it('context: included scopes and the restricted exclusion with its reason', () => {
    const [context] = contextInspections(session);
    expect(context?.included.map((item) => item.name)).toEqual(expect.arrayContaining(['Current page', 'User profile']));
    expect(context?.excluded).toEqual([expect.objectContaining({ name: 'employee-records' })]);
  });

  it('state: applied patch, stale conflict, and a debug reconstruction', () => {
    expect(stateTimeline(session, 'filters').map((entry) => entry.outcome)).toEqual(['applied', 'conflict']);
    expect(reconstructState(session, 'filters', 1)).toMatchObject({ value: { status: 'open' }, available: true });
  });

  it('workflow: paused for approval, approved by a supervisor, resumed, completed', () => {
    const [record] = workflows(session);
    expect(record).toMatchObject({ workflowId: 'application-reassignment', status: 'completed', pauses: [expect.objectContaining({ reason: 'approval' })] });
    expect(record?.steps.map((step) => [step.stepId, step.status])).toEqual([
      ['validate', 'completed'],
      ['read', 'completed'],
      ['supervisor-approval', 'completed'],
      ['reassign', 'completed'],
    ]);
    expect(record?.approvals[0]).toMatchObject({ status: 'approved', decidedBy: 'supervisor-1' });
  });

  it('traces: the chat run nests model, tool and firewall spans; the approval wait is correlated to it', () => {
    const chatRun = session.runs.find((run) => run.kind === 'copilot' && run.toolCallCount >= 3);
    const chatTrace = traces(session).find((trace) => trace.rootName === 'copilot.run' && trace.runId === chatRun?.runId);
    if (!chatTrace) throw new Error('chat trace missing');
    const names = new Set(flattenTrace(chatTrace).map((node) => node.span.name));
    for (const name of ['copilot.run', 'model.call', 'tool.execute', 'security.evaluate']) expect(names.has(name), name).toBe(true);
    // The human wait spans a request boundary, so it is its own span, joined by run id.
    expect(session.spans.some((span) => span.name === 'approval.wait' && span.correlation.runId === chatRun?.runId)).toBe(true);
  });
});

describe('DevTools security and independence (Section 179-180, 227)', () => {
  it('rejects requests without the token and scopes by tenant', async () => {
    expect((await demo.app.inject({ method: 'GET', url: '/devtools/session' })).statusCode).toBe(401);
    const otherTenant = await demo.app.inject({ method: 'GET', url: '/devtools/session', headers: { authorization: `Bearer ${TOKEN}`, 'x-devtools-tenant': 'tenant-b' } });
    expect(otherTenant.json<DevToolsSession>().runs).toEqual([]);
  });

  it('exports a sanitized, importable bundle', async () => {
    const exported = await demo.app.inject({ method: 'GET', url: '/devtools/export', headers: { authorization: `Bearer ${TOKEN}` } });
    const bundle = importBundle(exported.body);
    expect(bundle.mode).toBe('redacted');
    expect(bundle.metadata.eventCount).toBeGreaterThan(50);
  });

  it('with DevTools disabled the same app works and exposes no diagnostics', async () => {
    const plain = await createDevToolsDemo({ devtools: { enabled: false } });
    try {
      const result = await runScenario(plain);
      expect(result.agentStatus).toBe('completed');
      expect(result.workflowStatus).toBe('completed');
      expect((await plain.app.inject({ method: 'GET', url: '/devtools/session' })).statusCode).toBe(404);
    } finally {
      await plain.app.close();
    }
  });
});
