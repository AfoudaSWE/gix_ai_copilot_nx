import { beforeAll, describe, expect, it } from 'vitest';
import { createFirewallTelemetry, createRecordingTelemetry, createToolTelemetry } from '@gixcopilot/telemetry';
import type { RecordingTelemetry } from '@gixcopilot/telemetry';
import { SECRET, recordScenario } from './fixtures.spec-helper.js';
import {
  agentTree,
  citations,
  contextInspections,
  conversation,
  delegations,
  errors,
  filterEvents,
  firewallTimeline,
  flattenTrace,
  generativeUiRequests,
  handoffs,
  memoryTimeline,
  overview,
  paginate,
  reconstructState,
  retrievals,
  routingDecisions,
  stateTimeline,
  TIME_TRAVEL_NOTICE,
  toolTimeline,
  traces,
  workflow,
} from './inspectors.js';
import { createDevTools } from './recorder.js';
import type { DevToolsRecorder } from './recorder.js';
import type { DevToolsSession } from './types.js';

let telemetry: RecordingTelemetry;
let devtools: DevToolsRecorder;
let session: DevToolsSession;

beforeAll(async () => {
  telemetry = await recordScenario();
  devtools = createDevTools({ source: telemetry });
  session = devtools.getSession({ tenantId: 'tenant-a', subject: 'user-1' });
});

describe('overview and runs (Section 28-29)', () => {
  it('summarizes the tenant-scoped session without double-counting child usage', () => {
    const summary = overview(session);
    expect(summary.runs).toBe(5); // run-a + 4 agent runs, never tenant B's run-b
    expect(summary.toolCalls).toBe(3);
    expect(summary.retrievals).toBe(1);
    expect(summary.securityDecisions).toEqual({ allow: 1, deny: 1, approval: 1 });
    expect(summary.workflows).toMatchObject({ total: 1, failed: 1 });
    // 120 (copilot run) + 4 agent runs x 15, each counted exactly once.
    expect(summary.tokens.total).toBe(180);
  });

  it('links child runs to their parent', () => {
    const root = session.runs.find((run) => run.runId === 'agent-root');
    expect([...(root?.childRunIds ?? [])].sort()).toEqual(['agent-app', 'agent-pay']);
  });
});

describe('messages (Section 30)', () => {
  it('rebuilds the ordered conversation from the protocol events a client received', () => {
    const entries = conversation(session, 'run-a');
    const message = entries.find((entry) => entry.kind === 'message');
    expect(message?.kind === 'message' && message.message.text).toBe('APP-1024 is under review.');
    const tools = entries.filter((entry) => entry.kind === 'tool').map((entry) => (entry.kind === 'tool' ? [entry.tool.name, entry.tool.status] : []));
    expect(tools).toContainEqual(['applications.delete', 'failed']);
    expect(tools).toContainEqual(['ui.render.application_card', 'completed']);
    expect(entries.some((entry) => entry.kind === 'approval')).toBe(true);
  });
});

describe('context inspector (Section 31-34, 181)', () => {
  it('shows the budget, per-scope contribution, truncation and exclusion reasons the engine recorded', () => {
    const [context] = contextInspections(session, 'run-a');
    expect(context).toMatchObject({ budgetTokens: 8000, usedTokens: 2050, remainingTokens: 5950 });
    expect(context?.byScope).toEqual([
      { scope: 'system', items: 1, estimatedTokens: 1200 },
      { scope: 'application', items: 1, estimatedTokens: 850 },
    ]);
    expect(context?.included.find((item) => item.id === 'app')).toMatchObject({ priority: 'high', truncated: true });
    expect(context?.excluded).toEqual([expect.objectContaining({ name: 'employee-records', reason: 'permission-denied' })]);
  });
});

describe('state inspector and time travel (Section 35-36, 69-70)', () => {
  it('lists every revision change including the conflict, and reconstructs recorded values', () => {
    const timeline = stateTimeline(session, 'filters');
    expect(timeline.map((entry) => [entry.origin, entry.outcome, entry.toRevision])).toEqual([
      ['application', 'applied', 2],
      ['model', 'applied', 3],
      ['model', 'conflict', 3],
    ]);
    expect(reconstructState(session, 'filters', 3)).toMatchObject({ value: { status: 'closed' }, available: true, notice: TIME_TRAVEL_NOTICE });
    expect(reconstructState(session, 'filters', 99).available).toBe(false);
  });
});

describe('tool and security inspectors (Section 37-42, 182-183)', () => {
  it('shows the exact firewall decision the runtime recorded for each tool call', () => {
    const timeline = toolTimeline(session, 'run-a');
    const byName = new Map(timeline.map((entry) => [entry.name, entry]));
    expect(byName.get('applications.get')?.securityDecision).toBe('allow');
    expect(byName.get('applications.delete')?.securityDecision).toBe('deny');
    expect(byName.get('applications.delete')?.securityReasonCode).toBe('PERMISSION_DENIED');
    // Section 183: the displayed decision IS the recorded one, never recomputed.
    for (const entry of timeline) expect(entry.security?.decision).toBe(entry.securityDecision);
    expect(byName.get('applications.get')?.phases.map((phase) => phase.phase)).toEqual(['requested', 'authorization', 'execution', 'completed']);
  });

  it('renders a firewall stage timeline that ends WAITING for an approval decision', () => {
    const decision = session.security.find((entry) => entry.action === 'applications.update');
    if (!decision) throw new Error('approval decision was not recorded');
    const timeline = firewallTimeline(decision);
    expect(timeline).toMatchObject({ final: 'WAITING_FOR_APPROVAL', subject: 'user-1', roles: ['supervisor'], tenantId: 'tenant-a' });
    expect(timeline.stages.at(-1)).toMatchObject({ stage: 'approval', outcome: 'required' });
  });

  it('tracks approval lifecycle with requester, approver and wait time', () => {
    const approval = session.approvals.find((entry) => entry.approvalId === 'approval-1');
    expect(approval).toMatchObject({ status: 'approved', level: 'supervisor', decidedBy: 'supervisor-1' });
    expect(approval?.history.map((entry) => entry.phase)).toEqual(['requested', 'approved']);
  });
});

describe('RAG and citation inspectors (Section 43-45, 184)', () => {
  it('shows each pipeline stage count and why a chunk was excluded', () => {
    const [retrieval] = retrievals(session, 'run-a');
    expect(retrieval?.pipeline.map((stage) => stage.count)).toEqual([3, 2, 1, 2, 1, 1]);
    expect(retrieval?.candidates.find((candidate) => candidate.chunkId === 'chunk-hr')).toMatchObject({ selected: false, exclusionReason: 'acl' });
    const [citation] = citations(session, 'run-a');
    expect(citation).toMatchObject({ citationId: 'S1', chunkId: 'chunk-policy', sourceId: 'application-policy', inContext: true });
  });
});

describe('memory inspector (Section 46-47, 185)', () => {
  it("never shows another user's memory to the viewer", () => {
    const entries = memoryTimeline(session);
    expect(entries.map((entry) => entry.ownerId)).toEqual(['user-1']);
    expect(JSON.stringify(session)).not.toContain('another user secret preference');
    // Without a viewer subject (trusted in-process use) both are visible.
    expect(memoryTimeline(devtools.getSession({ tenantId: 'tenant-a' })).map((entry) => entry.ownerId).sort()).toEqual(['user-1', 'user-2']);
  });
});

describe('agent inspector (Section 48-51, 177, 220)', () => {
  it('builds the parent/child tree with why each agent ran and what it could see', () => {
    const [root] = agentTree(session);
    expect(root).toMatchObject({ agentId: 'orchestrator', selection: { via: 'routing', reason: 'EXPLICIT_AGENT' }, model: { provider: 'mock', model: 'test-model' } });
    expect(root?.children.map((child) => child.agentId).sort()).toEqual(['application', 'payment']);
    const payment = root?.children.find((child) => child.agentId === 'payment');
    expect(payment).toMatchObject({ selection: { via: 'delegation', fromAgentId: 'orchestrator' }, visibleTools: ['payments.get'], knowledgeSources: ['application-policy'], limits: { max_iterations: 12 } });
    expect(payment?.usage?.totalTokens).toBe(15);
    expect(payment?.children[0]).toMatchObject({ agentId: 'support', selection: { via: 'handoff', reason: 'PAYMENT_DISPUTE' } });
  });

  it('lists delegations with their child run, and handoffs and routing decisions', () => {
    expect(delegations(session).map((record) => [record.toAgentId, record.childRunId, record.status])).toEqual([
      ['application', 'agent-app', 'completed'],
      ['payment', 'agent-pay', 'completed'],
    ]);
    expect(handoffs(session)).toEqual([expect.objectContaining({ fromAgentId: 'payment', toAgentId: 'support' })]);
    expect(routingDecisions(session)[0]?.candidateAgentIds).toEqual(['orchestrator', 'support']);
  });
});

describe('workflow inspector (Section 52-54, 178)', () => {
  it('draws the graph with status, retries, pause, checkpoint and compensation', () => {
    const record = workflow(session, 'wf-1');
    expect(record).toMatchObject({ workflowId: 'order', version: '2', status: 'failed', retries: 1, checkpoints: 1, compensations: 1 });
    expect(record?.steps.map((step) => [step.stepId, step.stepType, step.status])).toEqual([
      ['validate', 'function', 'compensated'],
      ['approve', 'approval', 'completed'], // resumed after its approval pause
      ['charge', 'tool', 'failed'],
    ]);
    expect(record?.steps.find((step) => step.stepId === 'charge')?.dependencies).toEqual(['approve']);
    expect(record?.pauses).toEqual([expect.objectContaining({ reason: 'approval', stepId: 'approve' })]);
  });
});

describe('trace viewer (Section 57)', () => {
  it('nests spans into a waterfall tree per trace', () => {
    const trace = traces(session).find((candidate) => candidate.rootName === 'copilot.run' && candidate.runId === 'run-a');
    if (!trace) throw new Error('run-a trace missing');
    const names = flattenTrace(trace).map((node) => `${'  '.repeat(node.depth)}${node.span.name}`);
    expect(names[0]).toBe('copilot.run');
    expect(names).toContain('  context.resolve');
    expect(names).toContain('  rag.retrieve');
    expect(names).toContain('  agent.run');
    expect(flattenTrace(trace).every((node) => node.offsetMs >= 0)).toBe(true);
  });
});

describe('errors, events, search (Section 55-58, 169-170)', () => {
  it('normalizes errors from every source with their run', () => {
    const codes = errors(session).map((error) => `${error.source}:${error.code}`);
    expect(codes).toContain('security:PERMISSION_DENIED');
    expect(codes).toContain('workflow:WORKFLOW_STEP_EXECUTION_ERROR');
  });

  it('filters by tool, agent, workflow, error code and free text, and paginates', () => {
    expect(filterEvents(session.events, { toolName: 'applications.delete' }).length).toBeGreaterThan(0);
    expect(filterEvents(session.events, { agentId: 'payment', categories: ['agent'] }).every((event) => event.type === 'protocol.event')).toBe(true);
    expect(filterEvents(session.events, { workflowRunId: 'wf-1', categories: ['workflow'] }).length).toBe(13);
    expect(filterEvents(session.events, { errorCode: 'PERMISSION_DENIED' }).length).toBeGreaterThan(0);
    expect(filterEvents(session.events, { text: 'employee-records' })).toHaveLength(1);
    const page = paginate(session.events, { offset: 10, limit: 5 });
    expect(page).toMatchObject({ offset: 10, limit: 5, hasMore: true });
    expect(page.items).toHaveLength(5);
  });

  it('merges generative UI requests per tool call', () => {
    expect(generativeUiRequests(session)).toEqual([expect.objectContaining({ component: 'application_card', status: 'validated', propsValid: true })]);
  });
});

describe('isolation and redaction (Section 175, 185, 227)', () => {
  it("tenant A's session contains nothing from tenant B", () => {
    const serialized = JSON.stringify(session);
    expect(serialized).not.toContain('run-b');
    expect(serialized).not.toContain('hr.salaries');
    expect(devtools.getRun('run-b', { tenantId: 'tenant-a' })).toBeUndefined();
    expect(devtools.getRun('run-b', { tenantId: 'tenant-b' })?.status).toBe('completed');
  });

  it('no secret or password survives into any inspector view', () => {
    const serialized = JSON.stringify(devtools.getSession());
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('hunter2');
  });
});

describe('tool call ids are only unique per run (regression)', () => {
  it('never joins a tool call from one run to a firewall decision from another', async () => {
    const recording = createRecordingTelemetry();
    const tools = createToolTelemetry(recording);
    const firewall = createFirewallTelemetry(recording, { tracker: tools.tracker });
    for (const [runId, decision] of [['run-x', { decision: 'allow' as const }], ['run-y', { decision: 'deny' as const, reason: { code: 'PERMISSION_DENIED', message: 'no' } }]] as const) {
      await tools.instrument({
        async execute(_invocation: object) {
          const outcome = await firewall.instrument({ evaluate: (_request: object, _context: object) => Promise.resolve(decision) }).evaluate({ actionId: 'same-id', runId, toolCallId: 'same-id', action: 'items.get', arguments: {}, metadata: {} }, { metadata: { __gixcopilotTelemetry: { correlation: { runId } } } });
          if (outcome.decision !== 'allow') return { status: 'error' as const, toolCallId: 'same-id', error: { code: 'PERMISSION_DENIED' as const, message: 'no', retryable: false } };
          tools.onEvent({ phase: 'started', toolCallId: 'same-id', name: 'items.get' });
          return { status: 'success' as const, toolCallId: 'same-id', data: {} };
        },
      }).execute({ toolCallId: 'same-id', name: 'items.get', arguments: {}, context: { runId, signal: new AbortController().signal, metadata: { __gixcopilotTelemetry: { correlation: { runId } } } } });
    }
    const timeline = toolTimeline(createDevTools({ source: recording }).getSession());
    const byRun = new Map(timeline.map((entry) => [entry.runId, entry]));
    expect(byRun.get('run-x')?.security?.decision).toBe('allow');
    expect(byRun.get('run-y')?.security?.decision ?? byRun.get('run-y')?.securityDecision).toBe('deny');
  });
});

