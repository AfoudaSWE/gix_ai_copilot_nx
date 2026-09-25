import { randomUUID } from 'node:crypto';
import type { CopilotEvent, FinishReason, PublicCopilotError, Usage } from '@gixcopilot/protocol';
import type { Correlation } from './conventions.js';

/**
 * The diagnostics channel (Section 151-152): a versioned, internal event family that
 * DevTools and evals consume. Deliberately NOT part of the public `CopilotEvent` protocol -
 * implementation-level detail (span timings, redacted payloads, per-stage decisions) must
 * never be frozen into the stable wire contract every client parses.
 */
export const DIAGNOSTIC_VERSION = 1 as const;

interface DiagnosticBase {
  readonly id: string;
  readonly timestamp: string;
  readonly diagnosticVersion: typeof DIAGNOSTIC_VERSION;
  readonly correlation: Correlation;
}

export interface RunDiagnostic extends DiagnosticBase {
  readonly type: 'run';
  readonly phase: 'started' | 'completed' | 'failed' | 'cancelled';
  readonly kind: 'copilot' | 'agent' | 'workflow';
  readonly label?: string;
  readonly usage?: Usage;
  readonly latencyMs?: number;
  readonly error?: PublicCopilotError;
}

/** Any public protocol event, wrapped - the DevTools Messages/Events views are built from
 * exactly what a client would have received, never a parallel representation. */
export interface ProtocolEventDiagnostic extends DiagnosticBase {
  readonly type: 'protocol.event';
  readonly event: CopilotEvent;
}

export interface ContextScopeContribution {
  readonly scope: string;
  readonly items: number;
  readonly estimatedTokens: number;
}

export interface ContextItemDiagnostic {
  readonly id: string;
  readonly name: string;
  readonly scope: string;
  readonly priority: string;
  readonly sensitivity: string;
  readonly estimatedTokens: number;
  readonly truncated: boolean;
  readonly contextSource?: string;
  /** Present only when the telemetry mode allows payloads. */
  readonly text?: string;
}

export interface ContextExclusionDiagnostic {
  readonly id: string;
  readonly name: string;
  readonly scope: string;
  readonly reason: string;
  readonly detail?: string;
}

export interface ContextResolvedDiagnostic extends DiagnosticBase {
  readonly type: 'context.resolved';
  readonly budgetTokens?: number;
  readonly usedTokens: number;
  readonly remainingTokens?: number;
  readonly byScope: readonly ContextScopeContribution[];
  readonly included: readonly ContextItemDiagnostic[];
  readonly excluded: readonly ContextExclusionDiagnostic[];
  readonly resolutionMs: number;
}

export interface ModelCallDiagnostic extends DiagnosticBase {
  readonly type: 'model.call';
  readonly provider?: string;
  readonly model?: string;
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly attempts: number;
  readonly latencyMs: number;
  readonly timeToFirstChunkMs?: number;
  readonly usage?: Usage;
  readonly finishReason?: FinishReason;
  readonly toolCallsRequested: readonly string[];
  readonly error?: PublicCopilotError;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly messageCount: number;
  /** Redacted per telemetry mode; absent under `metadata-only`. */
  readonly request?: unknown;
  readonly responseText?: string;
  readonly responseToolCalls?: readonly { readonly id: string; readonly name: string; readonly arguments?: unknown }[];
}

export interface ToolPhaseTiming {
  readonly phase: 'requested' | 'validation' | 'authorization' | 'approval' | 'execution' | 'completed' | 'failed';
  readonly atMs: number;
}

export interface ToolExecutionDiagnostic extends DiagnosticBase {
  readonly type: 'tool.execution';
  readonly toolCallId: string;
  readonly name: string;
  readonly source?: string;
  readonly status: 'succeeded' | 'failed';
  readonly durationMs: number;
  readonly phases: readonly ToolPhaseTiming[];
  readonly securityDecision?: 'allow' | 'deny' | 'approval';
  readonly securityReasonCode?: string;
  readonly approvalLevel?: string;
  readonly error?: PublicCopilotError;
  readonly arguments?: unknown;
  readonly result?: unknown;
}

export interface SecurityStageResult {
  readonly stage: 'authentication' | 'rbac' | 'rate-limit' | 'policy' | 'risk' | 'approval';
  readonly outcome: 'allow' | 'deny' | 'required' | 'skipped';
  readonly reasonCode?: string;
  readonly durationMs?: number;
  readonly policyId?: string;
}

export interface SecurityDecisionDiagnostic extends DiagnosticBase {
  readonly type: 'security.decision';
  readonly actionId: string;
  readonly action: string;
  readonly toolCallId?: string;
  readonly decision: 'allow' | 'deny' | 'approval';
  readonly reasonCode?: string;
  readonly reasonMessage?: string;
  readonly approvalLevel?: string;
  readonly risk?: string;
  readonly reversibility?: string;
  readonly requiredPermissions?: readonly string[];
  readonly subject?: string;
  readonly roles?: readonly string[];
  readonly source?: string;
  readonly stages: readonly SecurityStageResult[];
  readonly durationMs?: number;
  readonly revalidation?: boolean;
}

export interface ApprovalDiagnostic extends DiagnosticBase {
  readonly type: 'approval';
  readonly approvalId: string;
  readonly action: string;
  readonly phase: 'requested' | 'approved' | 'rejected' | 'expired' | 'cancelled';
  readonly level: string;
  readonly status: string;
  readonly requestedBy?: string;
  readonly decidedBy?: string;
  readonly risk?: string;
  readonly createdAt?: string;
  readonly expiresAt?: string;
  readonly waitMs?: number;
  readonly summary?: string;
}

export interface RetrievalCandidateDiagnostic {
  readonly chunkId: string;
  readonly sourceId?: string;
  readonly documentId?: string;
  readonly title?: string;
  readonly score?: number;
  readonly selected: boolean;
  readonly citationId?: string;
  readonly exclusionReason?: string;
  readonly excerpt?: string;
}

export interface RagRetrievalDiagnostic extends DiagnosticBase {
  readonly type: 'rag.retrieval';
  readonly retrievalId: string;
  readonly durationMs: number;
  readonly topK?: number;
  readonly retrievedCount: number;
  readonly authorizedCount: number;
  readonly excludedCount: number;
  readonly rerankedCount: number;
  readonly includedCount: number;
  readonly citationCount: number;
  readonly candidates: readonly RetrievalCandidateDiagnostic[];
  readonly stages: readonly { readonly stage: string; readonly durationMs: number; readonly status: 'success' | 'error' }[];
  readonly query?: string;
  readonly error?: PublicCopilotError;
}

export interface MemoryOperationDiagnostic extends DiagnosticBase {
  readonly type: 'memory.operation';
  readonly operation: 'read' | 'search' | 'write' | 'delete';
  readonly memoryType?: string;
  readonly ownerType?: string;
  readonly ownerId?: string;
  readonly recordId?: string;
  readonly resultCount?: number;
  readonly durationMs: number;
  readonly outcome: 'allowed' | 'denied' | 'error';
  readonly provenance?: string;
  readonly error?: PublicCopilotError;
  readonly value?: unknown;
}

export interface StatePatchDiagnostic extends DiagnosticBase {
  readonly type: 'state.patch';
  readonly stateId: string;
  readonly origin: 'model' | 'application' | 'unknown';
  readonly op?: string;
  readonly fromRevision?: number;
  readonly toRevision?: number;
  readonly outcome: 'applied' | 'conflict' | 'rejected';
  readonly reason?: string;
  readonly value?: unknown;
}

export interface GenerativeUiRequestDiagnostic extends DiagnosticBase {
  readonly type: 'generative_ui.request';
  readonly toolCallId: string;
  readonly component: string;
  readonly status: 'requested' | 'validated' | 'rendered' | 'failed';
  readonly propsValid?: boolean;
  readonly error?: PublicCopilotError;
  readonly props?: unknown;
}

export interface SpanDiagnostic extends DiagnosticBase {
  readonly type: 'span';
  readonly name: string;
  readonly phase: 'started' | 'ended';
  readonly spanId: string;
  readonly traceId: string;
  readonly parentSpanId?: string;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly durationMs?: number;
  readonly status?: 'ok' | 'error' | 'cancelled';
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  readonly error?: string;
}

export interface MetricDiagnostic extends DiagnosticBase {
  readonly type: 'metric';
  readonly name: string;
  readonly kind: 'counter' | 'histogram' | 'gauge';
  readonly value: number;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface LogDiagnostic extends DiagnosticBase {
  readonly type: 'log';
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly fields?: Readonly<Record<string, unknown>>;
}

export type DiagnosticEvent =
  | RunDiagnostic
  | ProtocolEventDiagnostic
  | ContextResolvedDiagnostic
  | ModelCallDiagnostic
  | ToolExecutionDiagnostic
  | SecurityDecisionDiagnostic
  | ApprovalDiagnostic
  | RagRetrievalDiagnostic
  | MemoryOperationDiagnostic
  | StatePatchDiagnostic
  | GenerativeUiRequestDiagnostic
  | SpanDiagnostic
  | MetricDiagnostic
  | LogDiagnostic;

export type DiagnosticEventType = DiagnosticEvent['type'];

/** Fills in the envelope fields every diagnostic shares. */
export function diagnostic<T extends DiagnosticEvent>(
  body: Omit<T, 'id' | 'timestamp' | 'diagnosticVersion' | 'correlation'> & { readonly correlation?: Correlation },
  now: () => Date = () => new Date(),
): T {
  return {
    id: randomUUID(),
    timestamp: now().toISOString(),
    diagnosticVersion: DIAGNOSTIC_VERSION,
    ...body,
    correlation: body.correlation ?? {},
  } as T;
}
