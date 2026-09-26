import type { ContentPart, CopilotEvent, PublicCopilotError, Usage } from '@gixcopilot/protocol';
import type {
  ApprovalDiagnostic,
  ContextResolvedDiagnostic,
  DiagnosticEvent,
  GenerativeUiRequestDiagnostic,
  LogDiagnostic,
  MemoryOperationDiagnostic,
  ModelCallDiagnostic,
  RagRetrievalDiagnostic,
  SecurityDecisionDiagnostic,
  SpanDiagnostic,
  StatePatchDiagnostic,
  TelemetryMode,
  ToolExecutionDiagnostic,
} from '@gixcopilot/telemetry';

/**
 * Every record below is a read-only projection of the telemetry diagnostics stream (already
 * redacted per the session's mode when it was recorded). DevTools never recomputes a
 * runtime decision - it displays what the runtime recorded (Phase 11 Section 7, 183).
 */

/** What a projection is built from - `RecordingTelemetry.session()` or an imported bundle. */
export interface DiagnosticsSnapshot {
  readonly startedAt: string;
  readonly mode: TelemetryMode;
  readonly events: readonly DiagnosticEvent[];
  readonly spans: readonly SpanDiagnostic[];
  readonly dropped: number;
}

/** Who is looking - scopes what a session exposes (Section 25, 46, 147, 227). */
export interface DevToolsViewer {
  /** Only runs of this tenant are visible; everything else is as if it never happened. */
  readonly tenantId?: string;
  /** User-owned memory of any other subject is hidden (Section 46). */
  readonly subject?: string;
}

export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface RunRecord {
  readonly runId: string;
  readonly kind: 'copilot' | 'agent' | 'workflow';
  readonly label?: string;
  readonly threadId?: string;
  readonly rootRunId?: string;
  readonly parentRunId?: string;
  readonly tenantId?: string;
  readonly status: RunStatus;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly latencyMs?: number;
  readonly usage?: Usage;
  readonly models: readonly { readonly provider?: string; readonly model?: string }[];
  readonly modelCallCount: number;
  readonly toolCallCount: number;
  readonly retrievalCount: number;
  readonly memoryOpCount: number;
  readonly securityDecisionCount: number;
  readonly errorCount: number;
  readonly childRunIds: readonly string[];
  readonly error?: PublicCopilotError;
}

export interface MessageRecord {
  readonly messageId: string;
  readonly role: string;
  readonly text: string;
  readonly content?: readonly ContentPart[];
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly sequence: number;
}

export interface ToolCallMessageRecord {
  readonly toolCallId: string;
  readonly name: string;
  readonly source?: string;
  readonly arguments?: unknown;
  readonly result?: unknown;
  readonly error?: PublicCopilotError;
  readonly status: 'requested' | 'running' | 'completed' | 'failed';
  readonly requestedAt: string;
  readonly generativeUi: boolean;
  readonly sequence: number;
}

/** One ordered conversation timeline, exactly as a client would have received it (Section 30). */
export type ConversationEntry =
  | { readonly kind: 'message'; readonly message: MessageRecord }
  | { readonly kind: 'tool'; readonly tool: ToolCallMessageRecord }
  | { readonly kind: 'approval'; readonly approval: ApprovalRecord };

export interface ApprovalRecord {
  readonly approvalId: string;
  readonly action: string;
  readonly level: string;
  readonly status: string;
  readonly risk?: string;
  readonly requestedBy?: string;
  readonly decidedBy?: string;
  readonly createdAt?: string;
  readonly expiresAt?: string;
  readonly resolvedAt?: string;
  readonly waitMs?: number;
  readonly summary?: string;
  readonly runId?: string;
  readonly history: readonly { readonly phase: ApprovalDiagnostic['phase']; readonly at: string }[];
}

export interface ToolTimelineEntry {
  readonly toolCallId: string;
  readonly name: string;
  readonly source?: string;
  readonly status: ToolExecutionDiagnostic['status'];
  readonly durationMs: number;
  readonly phases: ToolExecutionDiagnostic['phases'];
  readonly securityDecision?: ToolExecutionDiagnostic['securityDecision'];
  readonly securityReasonCode?: string;
  readonly approvalLevel?: string;
  readonly arguments?: unknown;
  readonly result?: unknown;
  readonly error?: PublicCopilotError;
  readonly runId?: string;
  /** The Action Firewall's recorded decision for this call, if one was made. */
  readonly security?: SecurityDecisionDiagnostic;
}

export interface FirewallTimeline {
  readonly action: string;
  readonly toolCallId?: string;
  readonly decision: SecurityDecisionDiagnostic['decision'];
  readonly final: 'ALLOWED' | 'DENIED' | 'WAITING_FOR_APPROVAL';
  readonly reasonCode?: string;
  readonly subject?: string;
  readonly roles: readonly string[];
  readonly tenantId?: string;
  readonly risk?: string;
  readonly approvalLevel?: string;
  readonly stages: SecurityDecisionDiagnostic['stages'];
}

export interface ContextInspection {
  readonly runId?: string;
  readonly budgetTokens?: number;
  readonly usedTokens: number;
  readonly remainingTokens?: number;
  readonly byScope: ContextResolvedDiagnostic['byScope'];
  readonly included: ContextResolvedDiagnostic['included'];
  readonly excluded: ContextResolvedDiagnostic['excluded'];
  readonly resolutionMs: number;
  readonly at: string;
}

export interface StateTimelineEntry {
  readonly stateId: string;
  readonly origin: StatePatchDiagnostic['origin'];
  readonly op?: string;
  readonly fromRevision?: number;
  readonly toRevision?: number;
  readonly outcome: StatePatchDiagnostic['outcome'];
  readonly reason?: string;
  readonly at: string;
  readonly value?: unknown;
}

export interface StateSnapshot {
  readonly stateId: string;
  readonly revision: number;
  /** `undefined` when the recording mode kept no payloads (metadata-only). */
  readonly value?: unknown;
  readonly available: boolean;
  /** Always shown next to a reconstruction (Section 70). */
  readonly notice: string;
}

export interface RetrievalInspection {
  readonly retrievalId: string;
  readonly runId?: string;
  readonly query?: string;
  readonly durationMs: number;
  readonly topK?: number;
  readonly pipeline: readonly { readonly stage: string; readonly count: number }[];
  readonly stages: RagRetrievalDiagnostic['stages'];
  readonly candidates: RagRetrievalDiagnostic['candidates'];
  readonly error?: PublicCopilotError;
}

export interface CitationInspection {
  readonly citationId: string;
  readonly retrievalId: string;
  readonly chunkId: string;
  readonly sourceId?: string;
  readonly documentId?: string;
  readonly title?: string;
  readonly score?: number;
  /** Whether the cited chunk was actually selected into the prompt context. */
  readonly inContext: boolean;
}

export interface MemoryTimelineEntry {
  readonly operation: MemoryOperationDiagnostic['operation'];
  readonly memoryType?: string;
  readonly ownerType?: string;
  readonly ownerId?: string;
  readonly recordId?: string;
  readonly resultCount?: number;
  readonly outcome: MemoryOperationDiagnostic['outcome'];
  readonly provenance?: string;
  readonly durationMs: number;
  readonly at: string;
  readonly runId?: string;
  readonly value?: unknown;
}

export interface AgentNode {
  readonly agentRunId: string;
  readonly agentId: string;
  readonly version?: string;
  readonly parentRunId?: string;
  readonly rootRunId?: string;
  readonly status: RunStatus;
  readonly model?: { readonly provider?: string; readonly model?: string };
  readonly visibleTools: readonly string[];
  readonly knowledgeSources: readonly string[];
  readonly memoryTypes: readonly string[];
  readonly limits: Readonly<Record<string, number>>;
  readonly toolsCalled: readonly { readonly name: string; readonly status: string; readonly securityDecision?: string }[];
  readonly deniedTools: readonly string[];
  readonly modelCallCount: number;
  readonly usage?: Usage;
  readonly latencyMs?: number;
  readonly selection?: { readonly via: 'routing' | 'delegation' | 'handoff' | 'root'; readonly reason?: string; readonly fromAgentId?: string };
  readonly error?: PublicCopilotError;
  readonly children: readonly AgentNode[];
}

export interface DelegationRecord {
  readonly delegationId: string;
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly parentRunId: string;
  readonly childRunId?: string;
  readonly depth?: number;
  readonly status: 'running' | 'completed' | 'failed';
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly durationMs?: number;
  readonly error?: PublicCopilotError;
}

export interface HandoffRecord {
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly reason: string;
  readonly runId: string;
  readonly at: string;
}

export interface RoutingRecord {
  readonly router: 'deterministic' | 'model';
  readonly selectedAgentId: string;
  readonly candidateAgentIds: readonly string[];
  readonly reasonCode?: string;
  readonly runId: string;
  readonly at: string;
}

export interface WorkflowStepRecord {
  readonly stepId: string;
  readonly stepType?: string;
  readonly dependencies: readonly string[];
  readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'waiting' | 'compensated';
  readonly attempts: number;
  readonly compensated: boolean;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly durationMs?: number;
  readonly checkpointVersion?: number;
  readonly error?: PublicCopilotError;
}

export interface WorkflowRecord {
  readonly workflowRunId: string;
  readonly workflowId: string;
  readonly version?: string;
  readonly tenantId?: string;
  readonly status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  readonly currentStepId?: string;
  readonly waitingStepId?: string;
  readonly steps: readonly WorkflowStepRecord[];
  readonly retries: number;
  readonly checkpoints: number;
  readonly compensations: number;
  readonly pauses: readonly { readonly reason: string; readonly stepId?: string; readonly at: string }[];
  readonly approvals: readonly ApprovalRecord[];
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly error?: PublicCopilotError;
}

export interface TraceNode {
  readonly span: SpanDiagnostic;
  /** Offset from the trace's first span start, for waterfall layout (Section 57). */
  readonly offsetMs: number;
  readonly depth: number;
  readonly children: readonly TraceNode[];
}

export interface TraceRecord {
  readonly traceId: string;
  readonly rootName: string;
  readonly runId?: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly spanCount: number;
  readonly status: 'ok' | 'error' | 'cancelled' | 'open';
  readonly roots: readonly TraceNode[];
}

export interface ErrorRecord {
  readonly source: 'run' | 'model' | 'tool' | 'security' | 'rag' | 'memory' | 'workflow' | 'agent' | 'protocol' | 'span' | 'log';
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
  readonly runId?: string;
  readonly spanId?: string;
  readonly eventId: string;
  readonly at: string;
}

export interface OverviewRecord {
  readonly mode: TelemetryMode;
  readonly activeRunId?: string;
  readonly runs: number;
  readonly runningRuns: number;
  readonly models: readonly string[];
  readonly tokens: { readonly input: number; readonly output: number; readonly total: number };
  readonly latency: { readonly p50?: number; readonly p95?: number };
  readonly toolCalls: number;
  readonly retrievals: number;
  readonly memoryOperations: number;
  readonly agentRuns: number;
  readonly workflows: { readonly total: number; readonly running: number; readonly paused: number; readonly failed: number };
  readonly securityDecisions: { readonly allow: number; readonly deny: number; readonly approval: number };
  readonly errors: number;
  readonly dropped: number;
}

export type EventCategory =
  | 'run'
  | 'message'
  | 'model'
  | 'context'
  | 'tool'
  | 'security'
  | 'approval'
  | 'rag'
  | 'memory'
  | 'state'
  | 'generative-ui'
  | 'agent'
  | 'workflow'
  | 'span'
  | 'metric'
  | 'log';

export type EventSeverity = 'debug' | 'info' | 'warn' | 'error';

export interface EventFilter {
  readonly runId?: string;
  readonly threadId?: string;
  readonly types?: readonly string[];
  readonly categories?: readonly EventCategory[];
  readonly agentId?: string;
  readonly toolName?: string;
  readonly workflowRunId?: string;
  readonly errorCode?: string;
  readonly minSeverity?: EventSeverity;
  /** Case-insensitive free-text search over ids, names and codes (Section 169). */
  readonly text?: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
}

/** The projected, viewer-scoped model every inspector and UI panel reads. */
export interface DevToolsSession {
  readonly startedAt: string;
  readonly mode: TelemetryMode;
  readonly dropped: number;
  readonly events: readonly DiagnosticEvent[];
  readonly spans: readonly SpanDiagnostic[];
  readonly protocolEvents: readonly CopilotEvent[];
  readonly runs: readonly RunRecord[];
  readonly modelCalls: readonly ModelCallDiagnostic[];
  readonly contexts: readonly ContextResolvedDiagnostic[];
  readonly tools: readonly ToolExecutionDiagnostic[];
  readonly security: readonly SecurityDecisionDiagnostic[];
  readonly approvals: readonly ApprovalRecord[];
  readonly retrievals: readonly RagRetrievalDiagnostic[];
  readonly memory: readonly MemoryOperationDiagnostic[];
  readonly statePatches: readonly StatePatchDiagnostic[];
  readonly generativeUi: readonly GenerativeUiRequestDiagnostic[];
  readonly logs: readonly LogDiagnostic[];
}

/** A shareable, sanitized snapshot (Section 166-168). Importing one is inert data. */
export interface DebugBundle {
  readonly format: 'gixcopilot.devtools.bundle';
  readonly version: 1;
  readonly exportedAt: string;
  /** The mode the bundle was sanitized to - never more permissive than the recording. */
  readonly mode: TelemetryMode;
  readonly recordedMode: TelemetryMode;
  readonly metadata: {
    readonly diagnosticVersion: number;
    readonly runIds: readonly string[];
    readonly eventCount: number;
    readonly spanCount: number;
    readonly note: string;
  };
  readonly snapshot: DiagnosticsSnapshot;
}
