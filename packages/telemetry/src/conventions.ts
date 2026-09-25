/**
 * Semantic conventions (Phase 11 Section 12-13): one vocabulary for every span the runtime
 * produces, independent of any provider or backend. Attribute keys keep the `copilot.*`
 * prefix Phase 10's agent/workflow spans already established (the repository-consistent
 * equivalent of the spec's illustrative `aicopilot.*`), so existing traces stay joinable.
 */
export const SPAN_NAMES = {
  run: 'copilot.run',
  contextResolve: 'context.resolve',
  modelCall: 'model.call',
  toolExecute: 'tool.execute',
  securityEvaluate: 'security.evaluate',
  approvalWait: 'approval.wait',
  ragRetrieve: 'rag.retrieve',
  ragRerank: 'rag.rerank',
  memoryRead: 'memory.read',
  memoryWrite: 'memory.write',
  agentRun: 'agent.run',
  agentDelegate: 'agent.delegate',
  agentHandoff: 'agent.handoff',
  workflowRun: 'workflow.run',
  workflowStep: 'workflow.step',
  jobExecute: 'job.execute',
} as const;

export type SpanName = (typeof SPAN_NAMES)[keyof typeof SPAN_NAMES];

export const ATTR = {
  runId: 'copilot.run_id',
  threadId: 'copilot.thread_id',
  rootRunId: 'copilot.root_run_id',
  parentRunId: 'copilot.parent_run_id',
  messageId: 'copilot.message_id',
  toolCallId: 'copilot.tool_call_id',
  toolName: 'copilot.tool_name',
  toolSource: 'copilot.tool_source',
  retrievalId: 'copilot.retrieval_id',
  agentId: 'copilot.agent_id',
  agentDepth: 'copilot.depth',
  toAgentId: 'copilot.to_agent_id',
  workflowId: 'copilot.workflow_id',
  workflowRunId: 'copilot.workflow_run_id',
  workflowVersion: 'copilot.workflow_version',
  stepId: 'copilot.step_id',
  stepType: 'copilot.step_type',
  attempt: 'copilot.attempt',
  approvalId: 'copilot.approval_id',
  approvalLevel: 'copilot.approval_level',
  approvalRequired: 'copilot.approval_required',
  tenantId: 'copilot.tenant_id',
  modelProvider: 'copilot.model.provider',
  modelName: 'copilot.model.name',
  tokensInput: 'copilot.tokens.input',
  tokensOutput: 'copilot.tokens.output',
  tokensTotal: 'copilot.tokens.total',
  latencyMs: 'copilot.latency.ms',
  timeToFirstChunkMs: 'copilot.latency.first_chunk_ms',
  finishReason: 'copilot.finish_reason',
  securityDecision: 'copilot.security.decision',
  securityReasonCode: 'copilot.security.reason_code',
  status: 'copilot.status',
  errorCode: 'copilot.error.code',
  iteration: 'copilot.iteration',
  memoryType: 'copilot.memory.type',
  memoryOperation: 'copilot.memory.operation',
  contextScope: 'copilot.context.scope',
} as const;

export type AttributeValue = string | number | boolean;
export type Attributes = Readonly<Record<string, AttributeValue | undefined>>;

/** Correlation identity carried by every span/event/metric so traces, events and audit
 * records are joinable (observability skill: "logs and traces must be joinable"). */
export interface Correlation {
  readonly runId?: string;
  readonly threadId?: string;
  readonly rootRunId?: string;
  readonly parentRunId?: string;
  readonly tenantId?: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly parentSpanId?: string;
}

/** Maps a `Correlation` onto the standard attribute keys, dropping undefined values. */
export function correlationAttributes(correlation: Correlation | undefined): Record<string, AttributeValue> {
  const attributes: Record<string, AttributeValue> = {};
  if (!correlation) return attributes;
  if (correlation.runId) attributes[ATTR.runId] = correlation.runId;
  if (correlation.threadId) attributes[ATTR.threadId] = correlation.threadId;
  if (correlation.rootRunId) attributes[ATTR.rootRunId] = correlation.rootRunId;
  if (correlation.parentRunId) attributes[ATTR.parentRunId] = correlation.parentRunId;
  if (correlation.tenantId) attributes[ATTR.tenantId] = correlation.tenantId;
  return attributes;
}

/** Drops undefined values so an attribute bag is safe to hand to any backend. */
export function compactAttributes(attributes: Attributes | undefined): Record<string, AttributeValue> {
  const compact: Record<string, AttributeValue> = {};
  if (!attributes) return compact;
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) compact[key] = value;
  }
  return compact;
}
