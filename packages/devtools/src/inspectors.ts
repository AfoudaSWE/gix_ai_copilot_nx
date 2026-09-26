import type { CopilotEvent, PublicCopilotError } from '@gixcopilot/protocol';
import type { DiagnosticEvent, SecurityDecisionDiagnostic, SpanDiagnostic } from '@gixcopilot/telemetry';
import { isErrorEvent } from './session.js';
import type {
  AgentNode,
  CitationInspection,
  ContextInspection,
  ConversationEntry,
  DelegationRecord,
  DevToolsSession,
  ErrorRecord,
  EventCategory,
  EventFilter,
  EventSeverity,
  FirewallTimeline,
  HandoffRecord,
  MemoryTimelineEntry,
  MessageRecord,
  OverviewRecord,
  Page,
  RetrievalInspection,
  RoutingRecord,
  RunRecord,
  StateSnapshot,
  StateTimelineEntry,
  ToolCallMessageRecord,
  ToolTimelineEntry,
  TraceNode,
  TraceRecord,
  WorkflowRecord,
  WorkflowStepRecord,
} from './types.js';

/**
 * Read-only selectors, one per DevTools panel (Phase 11 Section 28-58). Each takes the
 * projected session and returns plain data; none of them evaluates policy, re-runs a tool,
 * or recomputes a decision the runtime already recorded.
 */

const byTime = <T extends { readonly timestamp: string }>(a: T, b: T): number => a.timestamp.localeCompare(b.timestamp);

function percentile(values: readonly number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function ms(from: string | undefined, to: string | undefined): number | undefined {
  if (!from || !to) return undefined;
  return Math.max(0, new Date(to).getTime() - new Date(from).getTime());
}

function list(value: unknown): string[] {
  return typeof value === 'string' && value.length > 0 ? value.split(',') : [];
}

// ---------------------------------------------------------------------------------------
// Overview + runs (Section 28-29)

export function overview(session: DevToolsSession): OverviewRecord {
  const tokens = { input: 0, output: 0, total: 0 };
  for (const run of session.runs) {
    // Each run reports only its own model calls (telemetry's `aggregateRunTreeUsage`
    // contract), so summing every run once counts every call exactly once (Section 214).
    if (!run.usage) continue;
    tokens.input += run.usage.inputTokens;
    tokens.output += run.usage.outputTokens;
    tokens.total += run.usage.totalTokens;
  }
  const latencies = session.runs.filter((run) => !run.parentRunId && run.latencyMs !== undefined).map((run) => run.latencyMs ?? 0);
  const running = session.runs.filter((run) => run.status === 'running');
  const workflowList = workflows(session);
  return {
    mode: session.mode,
    activeRunId: running.at(-1)?.runId ?? session.runs.at(-1)?.runId,
    runs: session.runs.length,
    runningRuns: running.length,
    models: [...new Set(session.modelCalls.map((call) => [call.provider, call.model].filter(Boolean).join('/')).filter(Boolean))],
    tokens,
    latency: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    toolCalls: session.tools.length,
    retrievals: session.retrievals.length,
    memoryOperations: session.memory.length,
    agentRuns: session.runs.filter((run) => run.kind === 'agent').length,
    workflows: {
      total: workflowList.length,
      running: workflowList.filter((workflow) => workflow.status === 'running').length,
      paused: workflowList.filter((workflow) => workflow.status === 'paused').length,
      failed: workflowList.filter((workflow) => workflow.status === 'failed').length,
    },
    securityDecisions: {
      allow: session.security.filter((decision) => decision.decision === 'allow').length,
      deny: session.security.filter((decision) => decision.decision === 'deny').length,
      approval: session.security.filter((decision) => decision.decision === 'approval').length,
    },
    errors: errors(session).length,
    dropped: session.dropped,
  };
}

export function findRun(session: DevToolsSession, runId: string): RunRecord | undefined {
  return session.runs.find((run) => run.runId === runId);
}

/** Every run id belonging to one root run's tree - a copilot run plus its agents/children. */
export function runTree(session: DevToolsSession, rootRunId: string): Set<string> {
  const ids = new Set([rootRunId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const run of session.runs) {
      if (ids.has(run.runId)) continue;
      if ((run.parentRunId && ids.has(run.parentRunId)) || (run.rootRunId && ids.has(run.rootRunId))) {
        ids.add(run.runId);
        grew = true;
      }
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------------------
// Messages (Section 30) - rebuilt from the exact protocol events a client received.

type ConversationEvent = Extract<
  CopilotEvent,
  { type: 'message.started' | 'message.delta' | 'message.end' | 'tool.requested' | 'tool.started' | 'tool.completed' | 'tool.failed' | 'approval.requested' }
>;
const CONVERSATION_TYPES = new Set<string>(['message.started', 'message.delta', 'message.end', 'tool.requested', 'tool.started', 'tool.completed', 'tool.failed', 'approval.requested']);

export function conversation(session: DevToolsSession, runId?: string): ConversationEntry[] {
  const scope = runId ? runTree(session, runId) : undefined;
  const events = session.protocolEvents.filter(
    (event): event is ConversationEvent => CONVERSATION_TYPES.has(event.type) && (!scope || scope.has(event.runId)),
  );
  const messages = new Map<string, MessageRecord & { text: string }>();
  const tools = new Map<string, ToolCallMessageRecord>();
  const order: { kind: 'message' | 'tool' | 'approval'; id: string; at: string; sequence: number }[] = [];
  const approvals = new Map(session.approvals.map((approval) => [approval.approvalId, approval]));

  for (const event of events) {
    switch (event.type) {
      case 'message.started':
        messages.set(event.messageId, { messageId: event.messageId, role: event.role, text: '', startedAt: event.timestamp, sequence: event.sequence });
        order.push({ kind: 'message', id: event.messageId, at: event.timestamp, sequence: event.sequence });
        break;
      case 'message.delta': {
        const message = messages.get(event.messageId);
        if (message) messages.set(event.messageId, { ...message, text: message.text + event.delta });
        break;
      }
      case 'message.end': {
        const message = messages.get(event.messageId);
        if (message) {
          const text = event.content.map((part) => (part.type === 'text' ? part.text : '')).join('') || message.text;
          messages.set(event.messageId, { ...message, text, content: event.content, endedAt: event.timestamp });
        }
        break;
      }
      case 'tool.requested':
        tools.set(`${event.runId}:${event.toolCallId}`, {
          toolCallId: event.toolCallId,
          name: event.name,
          source: event.source,
          arguments: event.arguments,
          status: 'requested',
          requestedAt: event.timestamp,
          generativeUi: event.name.startsWith('ui.render.'),
          sequence: event.sequence,
        });
        order.push({ kind: 'tool', id: `${event.runId}:${event.toolCallId}`, at: event.timestamp, sequence: event.sequence });
        break;
      case 'tool.started': {
        const key = `${event.runId}:${event.toolCallId}`;
        const tool = tools.get(key);
        if (tool) tools.set(key, { ...tool, status: 'running' });
        break;
      }
      case 'tool.completed': {
        const key = `${event.runId}:${event.toolCallId}`;
        const tool = tools.get(key);
        if (tool) tools.set(key, { ...tool, status: 'completed', result: event.result });
        break;
      }
      case 'tool.failed': {
        const key = `${event.runId}:${event.toolCallId}`;
        const tool = tools.get(key);
        if (tool) tools.set(key, { ...tool, status: 'failed', error: event.error });
        break;
      }
      case 'approval.requested':
        order.push({ kind: 'approval', id: event.approvalId, at: event.timestamp, sequence: event.sequence });
        if (!approvals.has(event.approvalId)) {
          approvals.set(event.approvalId, {
            approvalId: event.approvalId,
            action: event.action,
            level: event.approvalLevel,
            status: 'pending',
            risk: event.risk,
            expiresAt: event.expiresAt,
            summary: event.summary,
            runId: event.runId,
            history: [{ phase: 'requested', at: event.timestamp }],
          });
        }
        break;
    }
  }

  return order
    .sort((a, b) => a.at.localeCompare(b.at) || a.sequence - b.sequence)
    .flatMap((entry): ConversationEntry[] => {
      if (entry.kind === 'message') {
        const message = messages.get(entry.id);
        return message ? [{ kind: 'message', message }] : [];
      }
      if (entry.kind === 'tool') {
        const tool = tools.get(entry.id);
        return tool ? [{ kind: 'tool', tool }] : [];
      }
      const approval = approvals.get(entry.id);
      return approval ? [{ kind: 'approval', approval }] : [];
    });
}

// ---------------------------------------------------------------------------------------
// Context (Section 31-34) - the resolved-context diagnostic, never a re-resolution.

export function contextInspections(session: DevToolsSession, runId?: string): ContextInspection[] {
  return session.contexts
    .filter((context) => !runId || context.correlation.runId === runId)
    .map((context) => ({
      runId: context.correlation.runId,
      budgetTokens: context.budgetTokens,
      usedTokens: context.usedTokens,
      remainingTokens: context.remainingTokens,
      byScope: context.byScope,
      included: context.included,
      excluded: context.excluded,
      resolutionMs: context.resolutionMs,
      at: context.timestamp,
    }));
}

// ---------------------------------------------------------------------------------------
// State (Section 35-36, 69-70)

export const TIME_TRAVEL_NOTICE =
  'Debug reconstruction of recorded state only. This does not roll back application state or any external system.';

export function stateIds(session: DevToolsSession): string[] {
  return [...new Set(session.statePatches.map((patch) => patch.stateId))];
}

export function stateTimeline(session: DevToolsSession, stateId?: string): StateTimelineEntry[] {
  return session.statePatches
    .filter((patch) => !stateId || patch.stateId === stateId)
    .sort(byTime)
    .map((patch) => ({
      stateId: patch.stateId,
      origin: patch.origin,
      op: patch.op,
      fromRevision: patch.fromRevision,
      toRevision: patch.toRevision,
      outcome: patch.outcome,
      reason: patch.reason,
      at: patch.timestamp,
      value: patch.value,
    }));
}

/** The recorded value at a revision - only from applied patches that captured a value. */
export function reconstructState(session: DevToolsSession, stateId: string, revision: number): StateSnapshot {
  const applied = session.statePatches.filter(
    (patch) => patch.stateId === stateId && patch.outcome === 'applied' && patch.toRevision === revision,
  );
  const match = applied.at(-1);
  return {
    stateId,
    revision,
    value: match?.value,
    available: match !== undefined && match.value !== undefined,
    notice: TIME_TRAVEL_NOTICE,
  };
}

// ---------------------------------------------------------------------------------------
// Tools + security + approvals (Section 37-42)

export function toolTimeline(session: DevToolsSession, runId?: string): ToolTimelineEntry[] {
  const scope = runId ? runTree(session, runId) : undefined;
  const inScope = (id: string | undefined): boolean => !scope || (id !== undefined && scope.has(id));
  // Tool-call ids are only unique within a run, so every join keys on run + call id.
  const callKey = (runId: string | undefined, toolCallId: string | undefined): string => `${runId ?? ''}:${toolCallId ?? ''}`;
  const executed = new Set(session.tools.map((tool) => callKey(tool.correlation.runId, tool.toolCallId)));
  // A call the firewall blocked never reached the tool runtime, so it has a decision but no
  // execution record - show it from that recorded decision rather than dropping it.
  const blocked: (ToolTimelineEntry & { readonly at: string })[] = session.security
    .filter((decision) => decision.toolCallId !== undefined && decision.decision !== 'allow' && !executed.has(callKey(decision.correlation.runId, decision.toolCallId)) && inScope(decision.correlation.runId))
    .filter((decision, index, all) => all.findIndex((other) => callKey(other.correlation.runId, other.toolCallId) === callKey(decision.correlation.runId, decision.toolCallId)) === index)
    .map((decision) => ({
      at: decision.timestamp,
      toolCallId: decision.toolCallId ?? decision.actionId,
      name: decision.action,
      source: decision.source,
      status: 'failed' as const,
      durationMs: decision.durationMs ?? 0,
      phases: [
        { phase: 'requested' as const, atMs: 0 },
        { phase: 'authorization' as const, atMs: decision.durationMs ?? 0 },
        { phase: decision.decision === 'approval' ? ('approval' as const) : ('failed' as const), atMs: decision.durationMs ?? 0 },
      ],
      securityDecision: decision.decision,
      securityReasonCode: decision.reasonCode,
      approvalLevel: decision.approvalLevel,
      runId: decision.correlation.runId,
      security: decision,
    }));
  const ran = session.tools
    .filter((tool) => inScope(tool.correlation.runId))
    .map((tool) => ({
      at: tool.timestamp,
      toolCallId: tool.toolCallId,
      name: tool.name,
      source: tool.source,
      status: tool.status,
      durationMs: tool.durationMs,
      phases: tool.phases,
      securityDecision: tool.securityDecision,
      securityReasonCode: tool.securityReasonCode,
      approvalLevel: tool.approvalLevel,
      arguments: tool.arguments,
      result: tool.result,
      error: tool.error,
      runId: tool.correlation.runId,
      security: session.security.find((decision) => decision.toolCallId === tool.toolCallId && decision.correlation.runId === tool.correlation.runId),
    }));
  return [...ran, ...blocked].sort((a, b) => a.at.localeCompare(b.at)).map(({ at: _at, ...entry }) => entry);
}

/** The Action Firewall's own recorded stage outcomes, displayed as-is (Section 41, 183). */
export function firewallTimeline(decision: SecurityDecisionDiagnostic): FirewallTimeline {
  return {
    action: decision.action,
    toolCallId: decision.toolCallId,
    decision: decision.decision,
    final: decision.decision === 'allow' ? 'ALLOWED' : decision.decision === 'deny' ? 'DENIED' : 'WAITING_FOR_APPROVAL',
    reasonCode: decision.reasonCode,
    subject: decision.subject,
    roles: decision.roles ?? [],
    tenantId: decision.correlation.tenantId,
    risk: decision.risk,
    approvalLevel: decision.approvalLevel,
    stages: decision.stages,
  };
}

export function securityDecisions(session: DevToolsSession, runId?: string): FirewallTimeline[] {
  return session.security.filter((decision) => !runId || decision.correlation.runId === runId).sort(byTime).map(firewallTimeline);
}

// ---------------------------------------------------------------------------------------
// RAG + citations (Section 43-45)

export function retrievals(session: DevToolsSession, runId?: string): RetrievalInspection[] {
  return session.retrievals
    .filter((retrieval) => !runId || retrieval.correlation.runId === runId)
    .sort(byTime)
    .map((retrieval) => ({
      retrievalId: retrieval.retrievalId,
      runId: retrieval.correlation.runId,
      query: retrieval.query,
      durationMs: retrieval.durationMs,
      topK: retrieval.topK,
      pipeline: [
        { stage: 'retrieved', count: retrieval.retrievedCount },
        { stage: 'acl-authorized', count: retrieval.authorizedCount },
        { stage: 'acl-excluded', count: retrieval.excludedCount },
        { stage: 'reranked', count: retrieval.rerankedCount },
        { stage: 'in-context', count: retrieval.includedCount },
        { stage: 'cited', count: retrieval.citationCount },
      ],
      stages: retrieval.stages,
      candidates: retrieval.candidates,
      error: retrieval.error,
    }));
}

export function citations(session: DevToolsSession, runId?: string): CitationInspection[] {
  return retrievals(session, runId).flatMap((retrieval) =>
    retrieval.candidates.flatMap((candidate) =>
      candidate.citationId
        ? [
            {
              citationId: candidate.citationId,
              retrievalId: retrieval.retrievalId,
              chunkId: candidate.chunkId,
              sourceId: candidate.sourceId,
              documentId: candidate.documentId,
              title: candidate.title,
              score: candidate.score,
              inContext: candidate.selected,
            },
          ]
        : [],
    ),
  );
}

// ---------------------------------------------------------------------------------------
// Memory (Section 46-47) - already viewer-scoped by projectSession.

export function memoryTimeline(session: DevToolsSession, runId?: string): MemoryTimelineEntry[] {
  return session.memory
    .filter((operation) => !runId || operation.correlation.runId === runId)
    .sort(byTime)
    .map((operation) => ({
      operation: operation.operation,
      memoryType: operation.memoryType,
      ownerType: operation.ownerType,
      ownerId: operation.ownerId,
      recordId: operation.recordId,
      resultCount: operation.resultCount,
      outcome: operation.outcome,
      provenance: operation.provenance,
      durationMs: operation.durationMs,
      at: operation.timestamp,
      runId: operation.correlation.runId,
      value: operation.value,
    }));
}

// ---------------------------------------------------------------------------------------
// Agents (Section 48-51, 220)

function protocol<T extends CopilotEvent['type']>(session: DevToolsSession, type: T): Extract<CopilotEvent, { type: T }>[] {
  return session.protocolEvents.filter((event): event is Extract<CopilotEvent, { type: T }> => event.type === type);
}

export function delegations(session: DevToolsSession): DelegationRecord[] {
  const started = protocol(session, 'agent.delegation.started');
  const completed = protocol(session, 'agent.delegation.completed');
  const childRuns = protocol(session, 'agent.run.started');
  const claimed = new Set<string>();
  return started.map((event) => {
    const end = completed.find((candidate) => candidate.delegationId === event.delegationId);
    const child = childRuns.find(
      (run) => run.parentRunId === event.runId && run.agentId === event.toAgentId && !claimed.has(run.agentRunId),
    );
    if (child) claimed.add(child.agentRunId);
    return {
      delegationId: event.delegationId,
      fromAgentId: event.fromAgentId,
      toAgentId: event.toAgentId,
      parentRunId: event.runId,
      childRunId: child?.agentRunId,
      depth: event.depth,
      status: end ? end.status : 'running',
      startedAt: event.timestamp,
      endedAt: end?.timestamp,
      durationMs: ms(event.timestamp, end?.timestamp),
      error: end?.error,
    };
  });
}

export function handoffs(session: DevToolsSession): HandoffRecord[] {
  return protocol(session, 'agent.handoff').map((event) => ({
    fromAgentId: event.fromAgentId,
    toAgentId: event.toAgentId,
    reason: event.reason,
    runId: event.runId,
    at: event.timestamp,
  }));
}

export function routingDecisions(session: DevToolsSession): RoutingRecord[] {
  return protocol(session, 'agent.routing.decided').map((event) => ({
    router: event.router,
    selectedAgentId: event.selectedAgentId,
    candidateAgentIds: event.candidateAgentIds,
    reasonCode: event.reasonCode,
    runId: event.runId,
    at: event.timestamp,
  }));
}

/** Parent/child agent hierarchy with what each agent could see and did (Section 49, 220). */
export function agentTree(session: DevToolsSession, rootRunId?: string): AgentNode[] {
  const starts = protocol(session, 'agent.run.started');
  const ends = session.protocolEvents.filter(
    (event): event is Extract<CopilotEvent, { type: 'agent.run.completed' | 'agent.run.failed' | 'agent.run.cancelled' }> =>
      event.type === 'agent.run.completed' || event.type === 'agent.run.failed' || event.type === 'agent.run.cancelled',
  );
  const delegationList = delegations(session);
  const handoffList = protocol(session, 'agent.handoff');
  const routing = routingDecisions(session);
  const runSpans = session.spans.filter((span) => span.name === 'agent.run');

  function node(start: Extract<CopilotEvent, { type: 'agent.run.started' }>): AgentNode {
    const runId = start.agentRunId;
    const end = ends.find((event) => event.agentRunId === runId);
    const span = runSpans.find((candidate) => candidate.correlation.runId === runId);
    const attributes = span?.attributes ?? {};
    const runRecord = session.runs.find((run) => run.runId === runId);
    const toolCalls = session.tools.filter((tool) => tool.correlation.runId === runId);
    const denied = session.security.filter((decision) => decision.correlation.runId === runId && decision.decision === 'deny');
    const modelCalls = session.modelCalls.filter((call) => call.correlation.runId === runId);
    const delegation = delegationList.find((record) => record.childRunId === runId);
    const handoff = start.parentRunId ? handoffList.find((event) => event.runId === start.parentRunId && event.toAgentId === start.agentId) : undefined;
    const routed = !start.parentRunId ? routing.find((record) => record.selectedAgentId === start.agentId) : undefined;
    const limits: Record<string, number> = {};
    for (const key of ['max_iterations', 'max_tool_calls', 'max_delegations', 'max_depth']) {
      const value = attributes[`copilot.agent.${key}`];
      if (typeof value === 'number') limits[key] = value;
    }
    const provider = typeof attributes['copilot.model.provider'] === 'string' ? attributes['copilot.model.provider'] : modelCalls[0]?.provider;
    const model = typeof attributes['copilot.model.name'] === 'string' ? attributes['copilot.model.name'] : modelCalls[0]?.model;
    const error: PublicCopilotError | undefined = end?.type === 'agent.run.failed' ? end.error : undefined;
    return {
      agentRunId: runId,
      agentId: start.agentId,
      version: typeof attributes['copilot.agent.version'] === 'string' ? attributes['copilot.agent.version'] : undefined,
      parentRunId: start.parentRunId,
      rootRunId: start.rootRunId,
      status: !end ? 'running' : end.type === 'agent.run.completed' ? 'completed' : end.type === 'agent.run.failed' ? 'failed' : 'cancelled',
      model: provider || model ? { provider, model } : undefined,
      visibleTools: list(attributes['copilot.agent.visible_tools']),
      knowledgeSources: list(attributes['copilot.agent.knowledge_sources']),
      memoryTypes: list(attributes['copilot.agent.memory_types']),
      limits,
      toolsCalled: toolCalls.map((tool) => ({ name: tool.name, status: tool.status, securityDecision: tool.securityDecision })),
      deniedTools: [...new Set([...denied.map((decision) => decision.action), ...toolCalls.filter((tool) => tool.securityDecision === 'deny').map((tool) => tool.name)])],
      modelCallCount: modelCalls.length,
      usage: runRecord?.usage,
      latencyMs: runRecord?.latencyMs ?? span?.durationMs,
      selection: delegation
        ? { via: 'delegation', fromAgentId: delegation.fromAgentId }
        : handoff
          ? { via: 'handoff', fromAgentId: handoff.fromAgentId, reason: handoff.reason }
          : routed
            ? { via: 'routing', reason: routed.reasonCode }
            : { via: 'root' },
      error,
      children: starts.filter((child) => child.parentRunId === runId).map(node),
    };
  }

  const roots = starts.filter((start) => (rootRunId ? start.agentRunId === rootRunId : !start.parentRunId || !starts.some((other) => other.agentRunId === start.parentRunId)));
  return roots.map(node);
}

// ---------------------------------------------------------------------------------------
// Workflows (Section 52-54)

type WorkflowEvent = Extract<CopilotEvent, { readonly workflowRunId: string }>;

export function workflows(session: DevToolsSession): WorkflowRecord[] {
  const ids = [...new Set(session.protocolEvents.flatMap((event) => ('workflowRunId' in event ? [event.workflowRunId] : [])))];
  return ids.map((workflowRunId) => workflow(session, workflowRunId)).filter((record): record is WorkflowRecord => record !== undefined);
}

export function workflow(session: DevToolsSession, workflowRunId: string): WorkflowRecord | undefined {
  const events = session.protocolEvents
    .filter((event): event is WorkflowEvent => 'workflowRunId' in event && event.workflowRunId === workflowRunId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.sequence - b.sequence);
  const started = events.find((event) => event.type === 'workflow.run.started');
  if (!started && events.length === 0) return undefined;
  const runSpan = session.spans.find((span) => span.name === 'workflow.run' && span.correlation.runId === workflowRunId);
  const shape = typeof runSpan?.attributes['copilot.workflow.steps'] === 'string' ? runSpan.attributes['copilot.workflow.steps'] : '';

  const steps = new Map<string, WorkflowStepRecord & { dependencies: string[] }>();
  for (const entry of shape.split(',').filter(Boolean)) {
    const [stepId = '', stepType, deps = ''] = entry.split(':');
    steps.set(stepId, { stepId, stepType, dependencies: deps.split('|').filter(Boolean), status: 'pending', attempts: 0, compensated: false });
  }
  const upsert = (stepId: string, patch: Partial<WorkflowStepRecord>): void => {
    const current = steps.get(stepId) ?? { stepId, dependencies: [], status: 'pending' as const, attempts: 0, compensated: false };
    steps.set(stepId, { ...current, ...patch, dependencies: current.dependencies });
  };

  let status: WorkflowRecord['status'] = 'running';
  let workflowId = started && 'workflowId' in started ? started.workflowId : '';
  let waitingStepId: string | undefined;
  let retries = 0;
  let checkpoints = 0;
  let compensations = 0;
  let error: PublicCopilotError | undefined;
  let endedAt: string | undefined;
  const pauses: WorkflowRecord['pauses'][number][] = [];

  for (const event of events) {
    switch (event.type) {
      case 'workflow.run.started':
        workflowId = event.workflowId;
        status = 'running';
        waitingStepId = undefined;
        break;
      case 'workflow.run.resumed': {
        // The engine resumes an approval pause only once the approval was granted (a
        // rejection emits failure events instead) and records that step as completed in the
        // checkpoint without a separate step event - mirror that here.
        const lastPause = pauses.at(-1);
        if (waitingStepId && lastPause?.reason === 'approval') {
          upsert(waitingStepId, { status: 'completed', endedAt: event.timestamp, durationMs: ms(steps.get(waitingStepId)?.startedAt, event.timestamp) });
        } else if (waitingStepId) {
          upsert(waitingStepId, { status: 'pending' });
        }
        workflowId = event.workflowId;
        status = 'running';
        waitingStepId = undefined;
        break;
      }
      case 'workflow.run.paused':
        status = 'paused';
        waitingStepId = event.stepId;
        pauses.push({ reason: event.reason, stepId: event.stepId, at: event.timestamp });
        if (event.stepId) upsert(event.stepId, { status: 'waiting' });
        break;
      case 'workflow.run.completed':
        status = 'completed';
        endedAt = event.timestamp;
        break;
      case 'workflow.run.failed':
        status = 'failed';
        error = event.error;
        endedAt = event.timestamp;
        break;
      case 'workflow.run.cancelled':
        status = 'cancelled';
        endedAt = event.timestamp;
        break;
      case 'workflow.step.started':
        if (event.phase === 'compensation') break;
        upsert(event.stepId, { stepType: event.stepType, status: 'running', attempts: event.attempt, startedAt: steps.get(event.stepId)?.startedAt ?? event.timestamp });
        break;
      case 'workflow.step.completed': {
        if (event.phase === 'compensation') {
          compensations += 1;
          upsert(event.stepId, { status: 'compensated', compensated: true });
          break;
        }
        const current = steps.get(event.stepId);
        upsert(event.stepId, { status: 'completed', attempts: event.attempt, endedAt: event.timestamp, durationMs: ms(current?.startedAt, event.timestamp) });
        break;
      }
      case 'workflow.step.failed':
        if (event.willRetry) retries += 1;
        if (event.phase === 'compensation') break;
        upsert(event.stepId, { status: event.willRetry ? 'running' : 'failed', attempts: event.attempt, error: event.error, endedAt: event.willRetry ? undefined : event.timestamp });
        break;
      case 'workflow.checkpoint.saved':
        checkpoints += 1;
        upsert(event.stepId, { checkpointVersion: event.version });
        break;
    }
  }

  const stepList = [...steps.values()];
  const current = stepList.filter((step) => step.status === 'running').at(-1);
  return {
    workflowRunId,
    workflowId,
    version: typeof runSpan?.attributes['copilot.workflow_version'] === 'string' ? runSpan.attributes['copilot.workflow_version'] : undefined,
    tenantId: runSpan?.correlation.tenantId,
    status,
    currentStepId: current?.stepId,
    waitingStepId: status === 'paused' ? waitingStepId : undefined,
    steps: stepList,
    retries,
    checkpoints,
    compensations,
    pauses,
    approvals: session.approvals.filter((approval) => approval.runId === workflowRunId),
    startedAt: started?.timestamp,
    endedAt,
    error,
  };
}

// ---------------------------------------------------------------------------------------
// Traces (Section 57)

export function traces(session: DevToolsSession): TraceRecord[] {
  const ended = new Map(session.spans.map((span) => [span.spanId, span]));
  // Spans still open have only a `started` event - show them, marked open.
  for (const event of session.events) {
    if (event.type === 'span' && event.phase === 'started' && !ended.has(event.spanId)) ended.set(event.spanId, event);
  }
  const byTrace = new Map<string, SpanDiagnostic[]>();
  for (const span of ended.values()) byTrace.set(span.traceId, [...(byTrace.get(span.traceId) ?? []), span]);

  return [...byTrace.entries()]
    .map(([traceId, spans]) => {
      const start = Math.min(...spans.map((span) => span.startedAt));
      const end = Math.max(...spans.map((span) => span.endedAt ?? span.startedAt));
      const ids = new Set(spans.map((span) => span.spanId));
      const build = (span: SpanDiagnostic, depth: number): TraceNode => ({
        span,
        offsetMs: span.startedAt - start,
        depth,
        children: spans
          .filter((child) => child.parentSpanId === span.spanId)
          .sort((a, b) => a.startedAt - b.startedAt)
          .map((child) => build(child, depth + 1)),
      });
      const roots = spans.filter((span) => !span.parentSpanId || !ids.has(span.parentSpanId)).sort((a, b) => a.startedAt - b.startedAt);
      const first = roots[0];
      const statuses = spans.map((span) => (span.phase === 'started' ? 'open' : (span.status ?? 'ok')));
      return {
        traceId,
        rootName: first?.name ?? 'unknown',
        runId: first?.correlation.runId,
        startedAt: start,
        durationMs: end - start,
        spanCount: spans.length,
        status: statuses.includes('error') ? 'error' : statuses.includes('cancelled') ? 'cancelled' : statuses.includes('open') ? 'open' : 'ok',
        roots: roots.map((root) => build(root, 0)),
      } satisfies TraceRecord;
    })
    .sort((a, b) => a.startedAt - b.startedAt);
}

/** Depth-first flattening for a waterfall list (Section 57). */
export function flattenTrace(trace: TraceRecord): TraceNode[] {
  const out: TraceNode[] = [];
  const visit = (node: TraceNode): void => {
    out.push(node);
    node.children.forEach(visit);
  };
  trace.roots.forEach(visit);
  return out;
}

// ---------------------------------------------------------------------------------------
// Errors (Section 58)

function errorOf(event: DiagnosticEvent): Omit<ErrorRecord, 'eventId' | 'at' | 'runId'> | undefined {
  const from = (source: ErrorRecord['source'], error: PublicCopilotError | undefined, fallback: string): Omit<ErrorRecord, 'eventId' | 'at' | 'runId'> => ({
    source,
    code: error?.code ?? fallback,
    message: error?.message ?? fallback,
    retryable: error?.retryable,
  });
  switch (event.type) {
    case 'run':
      return from('run', event.error, 'RUN_FAILED');
    case 'model.call':
      return from('model', event.error, 'MODEL_FAILED');
    case 'tool.execution':
      return from('tool', event.error, 'TOOL_FAILED');
    case 'security.decision':
      return { source: 'security', code: event.reasonCode ?? 'DENIED', message: event.reasonMessage ?? `Action ${event.action} denied` };
    case 'rag.retrieval':
      return from('rag', event.error, 'RETRIEVAL_FAILED');
    case 'memory.operation':
      return from('memory', event.error, event.outcome === 'denied' ? 'MEMORY_DENIED' : 'MEMORY_FAILED');
    case 'generative_ui.request':
      return from('protocol', event.error, 'UI_RENDER_FAILED');
    case 'span':
      return { source: 'span', code: 'SPAN_ERROR', message: event.error ?? `${event.name} failed`, retryable: undefined };
    case 'log':
      return { source: 'log', code: 'LOG_ERROR', message: event.message };
    case 'protocol.event': {
      const inner = event.event;
      const error = 'error' in inner ? inner.error : undefined;
      const source: ErrorRecord['source'] = inner.type.startsWith('workflow') ? 'workflow' : inner.type.startsWith('agent') ? 'agent' : inner.type.startsWith('tool') ? 'tool' : 'protocol';
      return from(source, error, inner.type.toUpperCase());
    }
    case 'context.resolved':
    case 'approval':
    case 'state.patch':
    case 'metric':
      return undefined;
  }
}

export function errors(session: DevToolsSession): ErrorRecord[] {
  return session.events.filter(isErrorEvent).flatMap((event) => {
    const record = errorOf(event);
    if (!record) return [];
    return [{ ...record, eventId: event.id, at: event.timestamp, runId: event.correlation.runId, spanId: event.type === 'span' ? event.spanId : event.correlation.spanId }];
  });
}

// ---------------------------------------------------------------------------------------
// Events: categorize, filter, search, paginate (Section 55-56, 169-170)

export function categorize(event: DiagnosticEvent): EventCategory {
  switch (event.type) {
    case 'run':
      return 'run';
    case 'protocol.event': {
      const type = event.event.type;
      if (type.startsWith('message.')) return 'message';
      if (type.startsWith('tool.')) return event.event.type === 'tool.requested' && event.event.name.startsWith('ui.render.') ? 'generative-ui' : 'tool';
      if (type.startsWith('approval.')) return 'approval';
      if (type.startsWith('agent.')) return 'agent';
      if (type.startsWith('workflow.')) return 'workflow';
      return 'run';
    }
    case 'model.call':
      return 'model';
    case 'context.resolved':
      return 'context';
    case 'tool.execution':
      return 'tool';
    case 'security.decision':
      return 'security';
    case 'approval':
      return 'approval';
    case 'rag.retrieval':
      return 'rag';
    case 'memory.operation':
      return 'memory';
    case 'state.patch':
      return 'state';
    case 'generative_ui.request':
      return 'generative-ui';
    case 'span':
      return 'span';
    case 'metric':
      return 'metric';
    case 'log':
      return 'log';
  }
}

const SEVERITY_ORDER: Record<EventSeverity, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function severity(event: DiagnosticEvent): EventSeverity {
  if (event.type === 'log') return event.level;
  if (isErrorEvent(event)) return 'error';
  if (event.type === 'security.decision' && event.decision === 'approval') return 'warn';
  if (event.type === 'state.patch' && event.outcome !== 'applied') return 'warn';
  if (event.type === 'span' || event.type === 'metric') return 'debug';
  return 'info';
}

/** The subtype shown in an event list: the wrapped protocol type, or the diagnostic type. */
export function eventLabel(event: DiagnosticEvent): string {
  return event.type === 'protocol.event' ? event.event.type : event.type === 'span' ? `span:${event.name}` : event.type;
}

function mentionsAgent(event: DiagnosticEvent, agentId: string): boolean {
  if (event.type === 'protocol.event') {
    const inner = event.event as unknown as Record<string, unknown>;
    return ['agentId', 'fromAgentId', 'toAgentId', 'selectedAgentId'].some((key) => inner[key] === agentId);
  }
  if (event.type === 'run') return event.kind === 'agent' && event.label === agentId;
  if (event.type === 'span') return event.attributes['copilot.agent_id'] === agentId;
  return false;
}

function mentionsTool(event: DiagnosticEvent, toolName: string): boolean {
  if (event.type === 'tool.execution') return event.name === toolName;
  if (event.type === 'security.decision') return event.action === toolName;
  if (event.type === 'protocol.event') return 'name' in event.event && event.event.name === toolName;
  if (event.type === 'span') return event.attributes['copilot.tool_name'] === toolName;
  return false;
}

function errorCodeOf(event: DiagnosticEvent): string | undefined {
  return errorOf(event)?.code;
}

export function filterEvents(events: readonly DiagnosticEvent[], filter: EventFilter = {}): DiagnosticEvent[] {
  const text = filter.text?.trim().toLowerCase();
  return events.filter((event) => {
    if (filter.runId && event.correlation.runId !== filter.runId && event.correlation.rootRunId !== filter.runId && event.correlation.parentRunId !== filter.runId) return false;
    if (filter.threadId && event.correlation.threadId !== filter.threadId) return false;
    if (filter.types && !filter.types.includes(eventLabel(event)) && !filter.types.includes(event.type)) return false;
    if (filter.categories && !filter.categories.includes(categorize(event))) return false;
    if (filter.minSeverity && SEVERITY_ORDER[severity(event)] < SEVERITY_ORDER[filter.minSeverity]) return false;
    if (filter.agentId && !mentionsAgent(event, filter.agentId)) return false;
    if (filter.toolName && !mentionsTool(event, filter.toolName)) return false;
    if (filter.workflowRunId) {
      const inner = event.type === 'protocol.event' ? (event.event as unknown as Record<string, unknown>)['workflowRunId'] : undefined;
      if (inner !== filter.workflowRunId && event.correlation.runId !== filter.workflowRunId) return false;
    }
    if (filter.errorCode && (!isErrorEvent(event) || errorCodeOf(event) !== filter.errorCode)) return false;
    if (text && !JSON.stringify(event).toLowerCase().includes(text)) return false;
    return true;
  });
}

/** Bounded pages so a UI never renders thousands of rows at once (Section 170). */
export function paginate<T>(items: readonly T[], options: { readonly offset?: number; readonly limit?: number } = {}): Page<T> {
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.min(500, Math.max(1, options.limit ?? 50));
  return { items: items.slice(offset, offset + limit), total: items.length, offset, limit, hasMore: offset + limit < items.length };
}

/** Generative UI requests merged per tool call (Section 39). */
export function generativeUiRequests(session: DevToolsSession): {
  readonly toolCallId: string;
  readonly component: string;
  readonly status: string;
  readonly propsValid?: boolean;
  readonly props?: unknown;
  readonly error?: PublicCopilotError;
  readonly requestedAt: string;
  readonly durationMs?: number;
}[] {
  const byCall = new Map<string, ReturnType<typeof generativeUiRequests>[number]>();
  for (const request of [...session.generativeUi].sort(byTime)) {
    const key = `${request.correlation.runId ?? ''}:${request.toolCallId}`;
    const previous = byCall.get(key);
    byCall.set(key, {
      toolCallId: request.toolCallId,
      component: request.component,
      status: request.status,
      propsValid: request.propsValid ?? previous?.propsValid,
      props: request.props ?? previous?.props,
      error: request.error ?? previous?.error,
      requestedAt: previous?.requestedAt ?? request.timestamp,
      durationMs: previous ? ms(previous.requestedAt, request.timestamp) : undefined,
    });
  }
  return [...byCall.values()];
}
