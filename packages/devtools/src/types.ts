import type { CopilotEvent, PublicCopilotError, Usage } from '@gixcopilot/protocol';
import type {
  ApprovalDiagnostic,
  ContextResolvedDiagnostic,
  DiagnosticEvent,
  GenerativeUiRequestDiagnostic,
  MemoryOperationDiagnostic,
  MetricDiagnostic,
  RagRetrievalDiagnostic,
  SecurityDecisionDiagnostic,
  SpanDiagnostic,
  StatePatchDiagnostic,
  ToolExecutionDiagnostic,
  TelemetryMode,
} from '@gixcopilot/telemetry';

export interface RunRecord {
  readonly id: string;
  readonly kind: 'copilot' | 'agent' | 'workflow';
  readonly threadId?: string;
  readonly rootRunId?: string;
  readonly parentRunId?: string;
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled';
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly latencyMs?: number;
  readonly usage?: Usage;
  readonly model?: { readonly provider?: string; readonly model?: string };
  readonly toolCallCount: number;
  readonly retrievalCount: number;
  readonly memoryOpCount: number;
  readonly agentRunIds: readonly string[];
  readonly workflowRunIds: readonly string[];
  readonly securityDecisionCount: number;
  readonly errorCount: number;
}

export interface AgentRecord {
  readonly agentRunId: string;
  readonly agentId: string;
  readonly runId: string;
  readonly rootRunId?: string;
  readonly parentRunId?: string;
  readonly children: readonly string[];
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled';
  readonly usage?: Usage;
  readonly iterations?: number;
}

export interface WorkflowStepRecord {
  readonly stepId: string;
  readonly stepType?: string;
  readonly status: 'running' | 'completed' | 'failed';
  readonly attempt: number;
  readonly phase?: 'forward' | 'compensation';
  readonly error?: PublicCopilotError;
}

export interface WorkflowRecord {
  readonly workflowRunId: string;
  readonly workflowId: string;
  readonly runId: string;
  readonly status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  readonly steps: readonly WorkflowStepRecord[];
  readonly pauses: readonly { readonly reason: string; readonly stepId?: string; readonly at: string }[];
}

/** All payloads originate in telemetry's already-redacted diagnostic stream. */
export interface DevToolsSession {
  readonly runs: readonly RunRecord[];
  readonly events: readonly DiagnosticEvent[];
  readonly protocolEvents: readonly CopilotEvent[];
  readonly spans: readonly SpanDiagnostic[];
  readonly tools: readonly ToolExecutionDiagnostic[];
  readonly security: readonly SecurityDecisionDiagnostic[];
  readonly approvals: readonly ApprovalDiagnostic[];
  readonly retrievals: readonly RagRetrievalDiagnostic[];
  readonly memory: readonly MemoryOperationDiagnostic[];
  readonly statePatches: readonly StatePatchDiagnostic[];
  readonly generativeUi: readonly GenerativeUiRequestDiagnostic[];
  readonly agents: readonly AgentRecord[];
  readonly workflows: readonly WorkflowRecord[];
  readonly contexts: readonly ContextResolvedDiagnostic[];
  readonly metrics: readonly MetricDiagnostic[];
  readonly dropped: number;
}

export interface DebugBundle {
  readonly version: 1;
  readonly exportedAt: string;
  readonly mode: TelemetryMode;
  readonly session: DevToolsSession;
  readonly metadata: { readonly sdkVersion: string };
}
