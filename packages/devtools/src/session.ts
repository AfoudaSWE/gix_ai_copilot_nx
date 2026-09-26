import type { CopilotEvent, PublicCopilotError, Usage } from '@gixcopilot/protocol';
import type {
  ApprovalDiagnostic,
  DiagnosticEvent,
  MemoryOperationDiagnostic,
  ModelCallDiagnostic,
  RunDiagnostic,
  SpanDiagnostic,
} from '@gixcopilot/telemetry';
import type { ApprovalRecord, DevToolsSession, DevToolsViewer, DiagnosticsSnapshot, RunRecord, RunStatus } from './types.js';

type Correlated = { readonly correlation: { readonly runId?: string; readonly rootRunId?: string; readonly parentRunId?: string; readonly tenantId?: string } };

const TENANT_ATTRIBUTE = 'copilot.tenant_id';

/**
 * Scopes a snapshot to one tenant (Phase 11 Section 227: cross-tenant traces inaccessible).
 * An event is visible when it carries the viewer's tenant, or carries no tenant but belongs
 * to a run tree that does. Anything tagged with another tenant, or with no provable owner,
 * is dropped - absence of ownership is never treated as permission.
 */
function tenantScope(snapshot: DiagnosticsSnapshot, tenantId: string): { events: DiagnosticEvent[]; spans: SpanDiagnostic[] } {
  const tenantOf = (item: Correlated & { readonly attributes?: Readonly<Record<string, unknown>> }): string | undefined => {
    const attribute = item.attributes?.[TENANT_ATTRIBUTE];
    return item.correlation.tenantId ?? (typeof attribute === 'string' ? attribute : undefined);
  };

  const owned = new Set<string>();
  const all: (Correlated & { readonly attributes?: Readonly<Record<string, unknown>> })[] = [...snapshot.events, ...snapshot.spans];
  for (const item of all) {
    if (tenantOf(item) === tenantId && item.correlation.runId) owned.add(item.correlation.runId);
  }
  // Children inherit ownership from their parent/root run until nothing new is learned.
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of all) {
      const { runId, rootRunId, parentRunId } = item.correlation;
      if (!runId || owned.has(runId) || tenantOf(item) !== undefined) continue;
      if ((rootRunId && owned.has(rootRunId)) || (parentRunId && owned.has(parentRunId))) {
        owned.add(runId);
        grew = true;
      }
    }
  }

  const visible = (item: Correlated & { readonly attributes?: Readonly<Record<string, unknown>> }): boolean => {
    const tenant = tenantOf(item);
    if (tenant !== undefined) return tenant === tenantId;
    const { runId, rootRunId } = item.correlation;
    return Boolean((runId && owned.has(runId)) || (rootRunId && owned.has(rootRunId)));
  };

  const spans = snapshot.spans.filter(visible);
  const visibleTraces = new Set(spans.map((span) => span.traceId));
  const spansInTraces = snapshot.spans.filter(
    (span) => visibleTraces.has(span.traceId) && (tenantOf(span) === undefined || tenantOf(span) === tenantId),
  );
  const events = snapshot.events.filter((event) => {
    if (event.type === 'span') return visibleTraces.has(event.traceId) && (tenantOf(event) === undefined || tenantOf(event) === tenantId);
    return visible(event);
  });
  return { events, spans: spansInTraces };
}

/** Hides user-owned memory belonging to anyone but the viewer (Section 46). */
function memoryVisible(event: MemoryOperationDiagnostic, subject: string | undefined): boolean {
  if (subject === undefined) return true;
  return event.ownerType !== 'user' || event.ownerId === undefined || event.ownerId === subject;
}

function of<T extends DiagnosticEvent['type']>(events: readonly DiagnosticEvent[], type: T): Extract<DiagnosticEvent, { type: T }>[] {
  return events.filter((event): event is Extract<DiagnosticEvent, { type: T }> => event.type === type);
}

function statusOf(phase: RunDiagnostic['phase']): RunStatus {
  return phase === 'started' ? 'running' : phase;
}

function addUsage(total: Usage | undefined, next: Usage | undefined): Usage | undefined {
  if (!next) return total;
  if (!total) return next;
  return { inputTokens: total.inputTokens + next.inputTokens, outputTokens: total.outputTokens + next.outputTokens, totalTokens: total.totalTokens + next.totalTokens };
}

function buildRuns(events: readonly DiagnosticEvent[], models: readonly ModelCallDiagnostic[]): RunRecord[] {
  interface Draft {
    runId: string;
    kind: RunRecord['kind'];
    label?: string;
    threadId?: string;
    rootRunId?: string;
    parentRunId?: string;
    tenantId?: string;
    status: RunStatus;
    startedAt?: string;
    endedAt?: string;
    latencyMs?: number;
    usage?: Usage;
    error?: PublicCopilotError;
  }
  const drafts = new Map<string, Draft>();
  for (const run of of(events, 'run')) {
    const runId = run.correlation.runId;
    if (!runId) continue;
    const draft = drafts.get(runId) ?? { runId, kind: run.kind, status: 'running' as RunStatus };
    draft.kind = run.kind;
    draft.label = run.label ?? draft.label;
    draft.threadId = run.correlation.threadId ?? draft.threadId;
    draft.rootRunId = run.correlation.rootRunId ?? draft.rootRunId;
    draft.parentRunId = run.correlation.parentRunId ?? draft.parentRunId;
    draft.tenantId = run.correlation.tenantId ?? draft.tenantId;
    if (run.phase === 'started') {
      draft.startedAt ??= run.timestamp;
      if (draft.status === 'running') draft.status = 'running';
    } else {
      draft.status = statusOf(run.phase);
      draft.endedAt = run.timestamp;
      draft.latencyMs = run.latencyMs ?? draft.latencyMs;
      draft.usage = run.usage ?? draft.usage;
      draft.error = run.error ?? draft.error;
    }
    drafts.set(runId, draft);
  }

  // One pass over the events, not one per run (Section 170: large sessions stay fast).
  const counts = new Map<string, Map<string, number>>();
  const bump = (runId: string, key: string): void => {
    const perRun = counts.get(runId) ?? new Map<string, number>();
    perRun.set(key, (perRun.get(key) ?? 0) + 1);
    counts.set(runId, perRun);
  };
  for (const event of events) {
    const runId = event.correlation.runId;
    if (!runId || !drafts.has(runId)) continue;
    bump(runId, event.type);
    if (isErrorEvent(event)) bump(runId, 'error');
  }
  const count = (key: string, runId: string): number => counts.get(runId)?.get(key) ?? 0;
  const modelsByRun = new Map<string, ModelCallDiagnostic[]>();
  for (const model of models) {
    const runId = model.correlation.runId;
    if (runId) modelsByRun.set(runId, [...(modelsByRun.get(runId) ?? []), model]);
  }
  const childrenByParent = new Map<string, string[]>();
  for (const draft of drafts.values()) {
    if (draft.parentRunId) childrenByParent.set(draft.parentRunId, [...(childrenByParent.get(draft.parentRunId) ?? []), draft.runId]);
  }

  return [...drafts.values()].map((draft) => {
    const runModels = modelsByRun.get(draft.runId) ?? [];
    const distinct = new Map<string, { provider?: string; model?: string }>();
    for (const model of runModels) distinct.set(`${model.provider ?? ''}/${model.model ?? ''}`, { provider: model.provider, model: model.model });
    const modelUsage = runModels.reduce<Usage | undefined>((total, model) => addUsage(total, model.usage), undefined);
    return {
      ...draft,
      usage: draft.usage ?? modelUsage,
      models: [...distinct.values()],
      modelCallCount: runModels.length,
      toolCallCount: count('tool.execution', draft.runId),
      retrievalCount: count('rag.retrieval', draft.runId),
      memoryOpCount: count('memory.operation', draft.runId),
      securityDecisionCount: count('security.decision', draft.runId),
      errorCount: count('error', draft.runId),
      childRunIds: childrenByParent.get(draft.runId) ?? [],
    };
  });
}

/** Whether a diagnostic represents a failure worth surfacing in the error inspector. */
export function isErrorEvent(event: DiagnosticEvent): boolean {
  switch (event.type) {
    case 'run':
      return event.phase === 'failed';
    case 'model.call':
      return event.status === 'failed';
    case 'tool.execution':
      return event.status === 'failed';
    case 'security.decision':
      return event.decision === 'deny';
    case 'rag.retrieval':
      return event.error !== undefined;
    case 'memory.operation':
      return event.outcome !== 'allowed';
    case 'generative_ui.request':
      return event.status === 'failed';
    case 'span':
      return event.status === 'error';
    case 'log':
      return event.level === 'error';
    case 'protocol.event':
      return ['run.failed', 'tool.failed', 'error', 'agent.run.failed', 'workflow.run.failed', 'workflow.step.failed'].includes(event.event.type);
    case 'context.resolved':
    case 'approval':
    case 'state.patch':
    case 'metric':
      return false;
  }
}

function buildApprovals(events: readonly ApprovalDiagnostic[]): ApprovalRecord[] {
  const byId = new Map<string, ApprovalRecord>();
  for (const event of events) {
    const previous = byId.get(event.approvalId);
    const resolved = event.phase !== 'requested';
    byId.set(event.approvalId, {
      approvalId: event.approvalId,
      action: event.action,
      level: event.level,
      status: event.status,
      risk: event.risk ?? previous?.risk,
      requestedBy: event.requestedBy ?? previous?.requestedBy,
      decidedBy: event.decidedBy ?? previous?.decidedBy,
      createdAt: event.createdAt ?? previous?.createdAt,
      expiresAt: event.expiresAt ?? previous?.expiresAt,
      resolvedAt: resolved ? event.timestamp : previous?.resolvedAt,
      waitMs: event.waitMs ?? previous?.waitMs,
      summary: event.summary ?? previous?.summary,
      runId: event.correlation.runId ?? previous?.runId,
      history: [...(previous?.history ?? []), { phase: event.phase, at: event.timestamp }],
    });
  }
  return [...byId.values()];
}

/**
 * Projects a raw diagnostics snapshot into the viewer-scoped session every inspector reads
 * (Section 23). Pure and deterministic: the same snapshot and viewer always give the same
 * session, which is what makes an exported bundle reproducible in another DevTools instance.
 */
export function projectSession(snapshot: DiagnosticsSnapshot, viewer: DevToolsViewer = {}): DevToolsSession {
  const scoped = viewer.tenantId === undefined ? { events: [...snapshot.events], spans: [...snapshot.spans] } : tenantScope(snapshot, viewer.tenantId);
  const events = scoped.events.filter((event) => event.type !== 'memory.operation' || memoryVisible(event, viewer.subject));
  const modelCalls: ModelCallDiagnostic[] = of(events, 'model.call');
  const protocolEvents: CopilotEvent[] = of(events, 'protocol.event').map((event) => event.event);

  return {
    startedAt: snapshot.startedAt,
    mode: snapshot.mode,
    dropped: snapshot.dropped,
    events,
    spans: scoped.spans,
    protocolEvents,
    runs: buildRuns(events, modelCalls),
    modelCalls,
    contexts: of(events, 'context.resolved'),
    tools: of(events, 'tool.execution'),
    security: of(events, 'security.decision'),
    approvals: buildApprovals(of(events, 'approval')),
    retrievals: of(events, 'rag.retrieval'),
    memory: of(events, 'memory.operation'),
    statePatches: of(events, 'state.patch'),
    generativeUi: of(events, 'generative_ui.request'),
    logs: of(events, 'log'),
  };
}
