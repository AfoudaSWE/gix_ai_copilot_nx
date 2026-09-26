import type { CopilotErrorCode, CopilotEvent } from '@gixcopilot/protocol';
import {
  createFirewallTelemetry,
  createRecordingTelemetry,
  createRetrieverTelemetry,
  createToolTelemetry,
  instrumentApprovalStore,
  instrumentContextEngine,
  instrumentMemoryService,
  observeStateStore,
  recordProtocolEvent,
  recordRun,
  withTelemetryMetadata,
} from '@gixcopilot/telemetry';
import type { RecordingTelemetry, TelemetryMode } from '@gixcopilot/telemetry';

/**
 * A realistic recorded session, produced through telemetry's REAL instrumentation wrappers
 * (not hand-written diagnostics): two tenants, a copilot run with context/RAG/memory/state/
 * tools/firewall/approval/generative UI, an orchestrator delegating to two specialists and
 * handing off, and a workflow that pauses for approval, resumes, fails and compensates.
 * DevTools' module boundary forbids importing the runtime packages themselves; the
 * end-to-end check against real agent/workflow/server runs lives in `@gixcopilot/testing`.
 */
export const SECRET = 'sk-devtoolsleakcheck1234567890';

let sequence = 0;
function event<T extends CopilotEvent['type']>(
  type: T,
  runId: string,
  body: Omit<Extract<CopilotEvent, { type: T }>, 'type' | 'id' | 'runId' | 'threadId' | 'sequence' | 'timestamp' | 'protocolVersion'> & { readonly parentRunId?: string; readonly rootRunId?: string },
  at: number,
): CopilotEvent {
  sequence += 1;
  return {
    type,
    id: `evt-${sequence}`,
    runId,
    threadId: 'thread-1',
    sequence,
    timestamp: new Date(at).toISOString(),
    protocolVersion: '1',
    ...body,
  } as unknown as CopilotEvent;
}

export async function recordScenario(mode: TelemetryMode = 'redacted'): Promise<RecordingTelemetry> {
  let clock = Date.UTC(2026, 8, 25, 12, 0, 0);
  let id = 0;
  const telemetry = createRecordingTelemetry({ mode, now: () => new Date(clock), nextId: () => `id-${++id}` });
  const tick = (ms = 5): number => (clock += ms);
  const emit = (e: CopilotEvent, tenantId = 'tenant-a'): void => recordProtocolEvent(telemetry, e, { tenantId });
  const a = { runId: 'run-a', threadId: 'thread-1', tenantId: 'tenant-a' };

  // ---- Copilot run (tenant A)
  const root = telemetry.startSpan('copilot.run', { correlation: a });
  recordRun(telemetry, { kind: 'copilot', phase: 'started', correlation: a });
  emit(event('run.started', 'run-a', {}, tick()));

  const engine = {
    resolve(_registry: object) {
      return Promise.resolve({
        items: [
          { id: 'sys', name: 'System', scope: 'system', priority: 'critical', sensitivity: 'public', estimatedTokens: 1200, truncated: false, text: 'system text' },
          { id: 'app', name: 'Application', scope: 'application', priority: 'high', sensitivity: 'internal', estimatedTokens: 850, truncated: true, text: `note ${SECRET}` },
        ],
        content: 'x',
        estimatedTokens: 2050,
        excluded: [{ id: 'hr', name: 'employee-records', scope: 'application', reason: 'permission-denied', detail: 'missing hr.read' }],
        diagnostics: { itemsRegistered: 3, itemsIncluded: 2, itemsExcluded: 1, resolutionMs: 4 },
      });
    },
  };
  await instrumentContextEngine(engine, telemetry, { maxContextTokens: 8000 }).resolve({}, { correlation: a, parentSpan: root });

  const retriever = {
    retrieve(_query: { text: string; topK?: number }, _context: { securityContext: object; telemetry?: unknown }) {
      return Promise.resolve({
        items: [{ citationId: 'S1', item: { chunk: { id: 'chunk-policy', content: 'Approval policy excerpt' }, score: 0.91, provenance: { sourceId: 'application-policy', documentId: 'doc-1' } } }],
        citations: [{}],
        diagnostics: { query: 'approval policy', retrievedCount: 3, authorizedCount: 2, excludedCount: 1, rerankedCount: 2, includedCount: 1, exclusions: [{ chunkId: 'chunk-hr', reason: 'acl' }] },
      });
    },
  };
  await createRetrieverTelemetry(telemetry).instrument(retriever).retrieve({ text: 'approval policy', topK: 3 }, { securityContext: { tenant: { tenantId: 'tenant-a' } }, telemetry: withTelemetryMetadata(undefined, { parentSpan: root, correlation: a }) });

  const memory = {
    save(input: { type: string; value: unknown }) { return Promise.resolve({ id: 'mem-1', type: input.type, owner: { type: 'user', id: 'user-1' }, value: input.value }); },
    get(_id: string) { return Promise.resolve(null); },
    search(_query?: object) { return Promise.resolve([{ record: { id: 'mem-2', type: 'durable', owner: { type: 'user', id: 'user-2' }, value: 'another user secret preference' } }]); },
    forget(_id?: string) { return Promise.resolve(); },
  };
  const instrumentedMemory = instrumentMemoryService(memory, telemetry, { correlation: a });
  await instrumentedMemory.save({ type: 'session', value: 'prefers email' });
  await instrumentedMemory.search({});

  let revision = 1;
  const state = {
    set<T>(_id: string, _value: T) { revision += 1; },
    update<T>(_id: string, _updater: (value: T) => T) { revision += 1; },
    getRevision(_id: string) { return revision; },
    get<T>(_id: string): T | undefined { return undefined; },
    applyPatch(_id: string, patch: { op: string; value: unknown }, baseRevision: number) {
      if (baseRevision !== revision) return { status: 'conflict' as const, currentRevision: revision };
      revision += 1;
      return { status: 'applied' as const, revision, value: patch.value };
    },
  };
  const observed = observeStateStore(state, telemetry, { correlation: a });
  observed.set('filters', { status: 'open' });
  observed.applyPatch('filters', { op: 'replace', value: { status: 'closed' } }, 2);
  observed.applyPatch('filters', { op: 'replace', value: { status: 'stale' } }, 1);

  // Tools through the firewall: allow, deny, approval.
  const tool = createToolTelemetry(telemetry, { now: () => tick(1) });
  const firewall = createFirewallTelemetry(telemetry, { tracker: tool.tracker, now: () => tick(1) });
  const decisions = {
    'applications.get': { decision: 'allow' as const },
    'applications.delete': { decision: 'deny' as const, reason: { code: 'PERMISSION_DENIED' as CopilotErrorCode, message: 'missing applications.delete' } },
    'applications.update': { decision: 'approval' as const, approval: { level: 'supervisor', reason: 'supervisor approval' } },
  };
  for (const [name, decision] of Object.entries(decisions)) {
    const toolCallId = `call-${name}`;
    const runtime = {
      async execute(_invocation: object) {
        await firewall.instrument({ evaluate: (_request: object, _context: object) => Promise.resolve(decision) }).evaluate(
          { actionId: toolCallId, runId: 'run-a', toolCallId, action: name, arguments: {}, metadata: { risk: 'write' } },
          { identity: { subject: 'user-1', roles: ['supervisor'] }, tenant: { tenantId: 'tenant-a' } },
        );
        if (decision.decision === 'deny') return { status: 'error' as const, toolCallId, error: { code: decision.reason.code, message: decision.reason.message, retryable: false } };
        if (decision.decision === 'approval') return { status: 'error' as const, toolCallId, error: { code: 'APPROVAL_REQUIRED' as CopilotErrorCode, message: decision.approval.reason, retryable: false } };
        tool.onEvent({ phase: 'started', toolCallId, name });
        return { status: 'success' as const, toolCallId, data: { id: 'APP-1024', token: SECRET } };
      },
    };
    emit(event('tool.requested', 'run-a', { toolCallId, name, arguments: { id: 'APP-1024' }, source: 'native' }, tick()));
    await tool.instrument(runtime).execute({ toolCallId, name, arguments: { id: 'APP-1024', password: 'hunter2' }, context: { runId: 'run-a', signal: new AbortController().signal, metadata: withTelemetryMetadata(undefined, { parentSpan: root, correlation: a }) } });
    emit(
      decision.decision === 'allow'
        ? event('tool.completed', 'run-a', { toolCallId, name, result: { id: 'APP-1024' } }, tick())
        : event('tool.failed', 'run-a', { toolCallId, name, error: { code: decision.decision === 'deny' ? decision.reason.code : 'APPROVAL_REQUIRED', message: 'not executed', retryable: false } }, tick()),
    );
  }

  const approvals = instrumentApprovalStore(
    {
      create: (_input: unknown) => Promise.resolve({ approvalId: 'approval-1', actionId: 'call-applications.update', runId: 'run-a', tenantId: 'tenant-a', approvalLevel: 'supervisor', status: 'pending', createdAt: new Date(clock).toISOString(), summary: 'Update APP-1024', approvals: [] }),
      approve: (_id: string) => Promise.resolve({ approvalId: 'approval-1', actionId: 'call-applications.update', runId: 'run-a', tenantId: 'tenant-a', approvalLevel: 'supervisor', status: 'approved', createdAt: new Date(clock - 30).toISOString(), summary: 'Update APP-1024', approvals: [{ approverSubject: 'supervisor-1', at: new Date(clock).toISOString() }] }),
      reject: () => Promise.reject(new Error('unused')),
      expire: () => Promise.reject(new Error('unused')),
      cancel: () => Promise.reject(new Error('unused')),
    },
    telemetry,
    { now: () => clock },
  );
  await approvals.create({});
  emit(event('approval.requested', 'run-a', { approvalId: 'approval-1', toolCallId: 'call-applications.update', action: 'applications.update', approvalLevel: 'supervisor', summary: 'Update APP-1024' }, tick()));
  tick(30);
  await approvals.approve('approval-1');

  // Messages + generative UI, exactly as a client receives them.
  emit(event('message.started', 'run-a', { messageId: 'msg-1', role: 'assistant' }, tick()));
  emit(event('message.delta', 'run-a', { messageId: 'msg-1', delta: 'APP-1024 is ' }, tick()));
  emit(event('message.delta', 'run-a', { messageId: 'msg-1', delta: 'under review.' }, tick()));
  emit(event('message.end', 'run-a', { messageId: 'msg-1', content: [{ type: 'text', text: 'APP-1024 is under review.' }] }, tick()));
  emit(event('tool.requested', 'run-a', { toolCallId: 'ui-1', name: 'ui.render.application_card', arguments: { applicationId: 'APP-1024' }, source: 'native' }, tick()));
  emit(event('tool.completed', 'run-a', { toolCallId: 'ui-1', name: 'ui.render.application_card', result: { rendered: true } }, tick()));

  // ---- Agents: orchestrator (routed) -> two delegations; payment hands off to support.
  const agent = (runId: string, agentId: string, parentRunId?: string): void => {
    const correlation = { runId, threadId: 'thread-1', rootRunId: 'agent-root', parentRunId, tenantId: 'tenant-a' };
    const span = telemetry.startSpan('agent.run', {
      parent: root,
      correlation,
      attributes: { 'copilot.agent_id': agentId, 'copilot.agent.visible_tools': agentId === 'payment' ? 'payments.get' : 'applications.get', 'copilot.agent.knowledge_sources': 'application-policy', 'copilot.model.provider': 'mock', 'copilot.model.name': 'test-model', 'copilot.agent.max_iterations': 12 },
    });
    recordRun(telemetry, { kind: 'agent', phase: 'started', correlation, label: agentId });
    emit(event('agent.run.started', runId, { agentId, agentRunId: runId, parentRunId, rootRunId: 'agent-root' }, tick()));
    recordRun(telemetry, { kind: 'agent', phase: 'completed', correlation, label: agentId, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, latencyMs: 40 });
    emit(event('agent.run.completed', runId, { agentId, agentRunId: runId, parentRunId, rootRunId: 'agent-root' }, tick()));
    span.end('ok');
  };
  emit(event('agent.routing.decided', 'agent-root', { router: 'deterministic', selectedAgentId: 'orchestrator', candidateAgentIds: ['orchestrator', 'support'], reasonCode: 'EXPLICIT_AGENT' }, tick()));
  agent('agent-root', 'orchestrator');
  for (const [child, target] of [['agent-app', 'application'], ['agent-pay', 'payment']] as const) {
    emit(event('agent.delegation.started', 'agent-root', { fromAgentId: 'orchestrator', toAgentId: target, delegationId: `del-${target}`, depth: 1, rootRunId: 'agent-root' }, tick()));
    agent(child, target, 'agent-root');
    emit(event('agent.delegation.completed', 'agent-root', { fromAgentId: 'orchestrator', toAgentId: target, delegationId: `del-${target}`, status: 'completed', rootRunId: 'agent-root' }, tick()));
  }
  emit(event('agent.handoff', 'agent-pay', { fromAgentId: 'payment', toAgentId: 'support', reason: 'PAYMENT_DISPUTE', rootRunId: 'agent-root' }, tick()));
  agent('agent-support', 'support', 'agent-pay');

  // ---- Workflow: validate -> approval (pause/resume) -> charge (fails) -> compensate.
  const wf = { runId: 'wf-1', tenantId: 'tenant-a' };
  const wfSpan = telemetry.startSpan('workflow.run', { correlation: wf, attributes: { 'copilot.workflow_version': '2', 'copilot.workflow.steps': 'validate:function:,approve:approval:validate,charge:tool:approve' } });
  const w = (type: CopilotEvent['type'], body: object): void => emit(event(type, 'wf-1', { workflowId: 'order', workflowRunId: 'wf-1', ...body } as never, tick()));
  w('workflow.run.started', {});
  w('workflow.step.started', { stepId: 'validate', stepType: 'function', attempt: 1 });
  w('workflow.step.completed', { stepId: 'validate', attempt: 1 });
  w('workflow.checkpoint.saved', { stepId: 'validate', version: 2 });
  w('workflow.step.started', { stepId: 'approve', stepType: 'approval', attempt: 1 });
  w('workflow.run.paused', { reason: 'approval', stepId: 'approve' });
  w('workflow.run.resumed', {});
  w('workflow.step.started', { stepId: 'charge', stepType: 'tool', attempt: 1 });
  w('workflow.step.failed', { stepId: 'charge', attempt: 1, willRetry: true, error: { code: 'PROVIDER_ERROR', message: 'timeout', retryable: true } });
  w('workflow.step.failed', { stepId: 'charge', attempt: 2, willRetry: false, error: { code: 'PROVIDER_ERROR', message: 'timeout', retryable: true } });
  w('workflow.step.started', { stepId: 'validate', stepType: 'function', attempt: 1, phase: 'compensation' });
  w('workflow.step.completed', { stepId: 'validate', attempt: 1, phase: 'compensation' });
  w('workflow.run.failed', { error: { code: 'WORKFLOW_STEP_EXECUTION_ERROR', message: 'charge failed', retryable: false } });
  wfSpan.end('error', 'charge failed');

  emit(event('run.completed', 'run-a', { usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } }, tick()));
  recordRun(telemetry, { kind: 'copilot', phase: 'completed', correlation: a, usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 }, latencyMs: 250 });
  root.end('ok');

  // ---- Tenant B: must never be visible to tenant A.
  const b = { runId: 'run-b', threadId: 'thread-b', tenantId: 'tenant-b' };
  const rootB = telemetry.startSpan('copilot.run', { correlation: b });
  recordRun(telemetry, { kind: 'copilot', phase: 'started', correlation: b });
  emit(event('tool.requested', 'run-b', { toolCallId: 'call-b', name: 'hr.salaries', arguments: {}, source: 'native' }, tick()), 'tenant-b');
  recordRun(telemetry, { kind: 'copilot', phase: 'completed', correlation: b, latencyMs: 10 });
  rootB.end('ok');

  return telemetry;
}
