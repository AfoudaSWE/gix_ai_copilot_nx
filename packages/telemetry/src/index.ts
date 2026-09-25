export { createNoopTelemetry, composeTelemetry } from './adapter.js';
export type { TelemetryAdapter, SpanHandle, SpanStatus, StartSpanOptions, MetricRecord } from './adapter.js';

export { SPAN_NAMES, ATTR, correlationAttributes, compactAttributes } from './conventions.js';
export type { SpanName, Attributes, AttributeValue, Correlation } from './conventions.js';

export { DIAGNOSTIC_VERSION, diagnostic } from './diagnostics.js';
export type {
  DiagnosticEvent,
  DiagnosticEventType,
  RunDiagnostic,
  ProtocolEventDiagnostic,
  ContextResolvedDiagnostic,
  ContextScopeContribution,
  ContextItemDiagnostic,
  ContextExclusionDiagnostic,
  ModelCallDiagnostic,
  ToolExecutionDiagnostic,
  ToolPhaseTiming,
  SecurityDecisionDiagnostic,
  SecurityStageResult,
  ApprovalDiagnostic,
  RagRetrievalDiagnostic,
  RetrievalCandidateDiagnostic,
  MemoryOperationDiagnostic,
  StatePatchDiagnostic,
  GenerativeUiRequestDiagnostic,
  SpanDiagnostic,
  MetricDiagnostic,
  LogDiagnostic,
} from './diagnostics.js';

export { DEFAULT_TELEMETRY_MODE, REDACTED, createRedactionPolicy, maskSecretsInText, maskPiiInText } from './redaction.js';
export type { TelemetryMode, RedactionPolicy, RedactionPolicyOptions, RedactionDataPolicy } from './redaction.js';

export { METRICS, createMetricsCollector, summarizeHistogram } from './metrics.js';
export type { MetricsCollector, MetricsSummary, HistogramSummary } from './metrics.js';

export { createCostEstimator, createStaticPricingTable } from './pricing.js';
export type { ModelPricing, PricingProvider, CostEstimate, CostEstimator } from './pricing.js';

export { ZERO_USAGE, addUsage, sumUsage, aggregateRunTreeUsage } from './usage.js';
export type { RunUsageEntry, RunTreeUsage } from './usage.js';

export { createOpenTelemetryAdapter } from './otel.js';
export type { OpenTelemetryAdapterOptions } from './otel.js';

export { createRecordingTelemetry } from './recording.js';
export type { RecordingTelemetry, RecordingTelemetryOptions, TelemetrySession, TelemetryListener } from './recording.js';

export { TELEMETRY_METADATA_KEY, readTelemetryMetadata, withTelemetryMetadata, stripTelemetryMetadata } from './instrument/telemetry-metadata.js';
export type { TelemetryMetadata } from './instrument/telemetry-metadata.js';

export { instrumentModelRuntime, createModelRuntimeTelemetryListener } from './instrument/model-runtime.js';
export type { ModelRuntimeLike, ModelExecutionRequestLike, ModelStreamEventLike, ModelRuntimeTelemetryEventLike, InstrumentModelRuntimeOptions } from './instrument/model-runtime.js';

export { createToolTelemetry, createToolCallTracker } from './instrument/tool-runtime.js';
export type { ToolTelemetry, ToolTelemetryOptions, ToolCallTracker, ToolRuntimeLike, ToolInvocationLike, ToolResultLike, ToolRuntimeMiddlewareLike, ToolRuntimeEventLike } from './instrument/tool-runtime.js';

export { createFirewallTelemetry, deriveSecurityStages } from './instrument/firewall.js';
export type { FirewallTelemetry, ActionFirewallLike, ActionRequestLike, ActionDecisionLike, SecurityContextLike, SecurityTelemetryEventLike } from './instrument/firewall.js';

export { instrumentApprovalStore } from './instrument/approvals.js';
export type { ApprovalStoreLike, ApprovalRequestLike } from './instrument/approvals.js';

export { createRetrieverTelemetry } from './instrument/retriever.js';
export type { RetrieverTelemetry, RetrieverLike, RetrievalQueryLike, RetrievalContextLike, RetrievalResultLike, KnowledgeMeasurementLike } from './instrument/retriever.js';

export { instrumentContextEngine } from './instrument/context-engine.js';
export type { ContextEngineLike, ContextRegistryLike, ResolvedContextLike, InstrumentContextEngineOptions, InstrumentedContextEngine, ContextResolveTelemetry } from './instrument/context-engine.js';

export { instrumentMemoryService } from './instrument/memory.js';
export type { MemoryServiceLike, MemoryRecordLike, InstrumentMemoryOptions } from './instrument/memory.js';

export { observeStateStore } from './instrument/state-store.js';
export type { CopilotStateStoreLike, StatePatchResultLike, ObserveStateStoreOptions } from './instrument/state-store.js';

export { recordProtocolEvent, recordRun } from './instrument/protocol-events.js';
export type { RecordRunOptions } from './instrument/protocol-events.js';
