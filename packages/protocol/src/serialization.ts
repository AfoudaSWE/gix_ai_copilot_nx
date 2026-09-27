import { z } from 'zod';
import { CopilotError } from './errors.js';
import { PROTOCOL_VERSION } from './version.js';
import type {
  AgentDelegationCompletedEvent,
  AgentDelegationStartedEvent,
  AgentHandoffEvent,
  AgentRoutingDecidedEvent,
  AgentRunCancelledEvent,
  AgentRunCompletedEvent,
  AgentRunFailedEvent,
  AgentRunStartedEvent,
  ApprovalApprovedEvent,
  ApprovalExpiredEvent,
  ApprovalRejectedEvent,
  ApprovalRequestedEvent,
  CopilotEvent,
  CopilotEventType,
  ErrorEvent,
  MessageDeltaEvent,
  MessageEndEvent,
  MessageStartEvent,
  RunCancelledEvent,
  RunCompletedEvent,
  RunFailedEvent,
  RunStartedEvent,
  ToolCallCompletedEvent,
  ToolCallFailedEvent,
  ToolCallRequestedEvent,
  ToolCallStartedEvent,
  UnknownCopilotEvent,
  WorkflowCheckpointSavedEvent,
  WorkflowRunCancelledEvent,
  WorkflowRunCompletedEvent,
  WorkflowRunFailedEvent,
  WorkflowRunPausedEvent,
  WorkflowRunResumedEvent,
  WorkflowRunStartedEvent,
  WorkflowStepCompletedEvent,
  WorkflowStepFailedEvent,
  WorkflowStepStartedEvent,
} from './events.js';

// ---------------------------------------------------------------------------------------
// Runtime schemas. These mirror the TypeScript types in events.ts/message.ts/usage.ts/
// errors.ts by construction; there is exactly one source of truth for each event shape.
// ---------------------------------------------------------------------------------------

const usageSchema = z.object({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  totalTokens: z.number().nonnegative(),
});

/**
 * Kept in sync with `CopilotErrorCode` in errors.ts by construction (one manual list is the
 * established pattern in this file - see the module doc comment above). This list was found
 * out of sync with errors.ts while extending it for Phase 10 (missing every Phase 8/9 code:
 * SOURCE_LOAD_FAILED..MEMORY_READ_DENIED) - fixed here alongside the new Phase 10 codes,
 * since a client parsing a legitimate Phase 8/9 error event would otherwise have gotten
 * `kind: 'invalid'` for a perfectly valid event (see Phase 10 Issues doc).
 */
const publicCopilotErrorSchema = z.object({
  code: z.enum([
    'PROTOCOL_ERROR',
    'VALIDATION_ERROR',
    'TRANSPORT_ERROR',
    'CANCELLED',
    'INTERNAL_ERROR',
    'MODEL_ERROR',
    'PROVIDER_ERROR',
    'AUTHENTICATION_ERROR',
    'RATE_LIMITED',
    'QUOTA_EXCEEDED',
    'BUDGET_EXCEEDED',
    'MODEL_NOT_FOUND',
    'CONTEXT_LIMIT_EXCEEDED',
    'TIMEOUT',
    'NETWORK_ERROR',
    'TOOL_NOT_FOUND',
    'TOOL_DISABLED',
    'TOOL_EXECUTION_ERROR',
    'TOOL_OUTPUT_INVALID',
    'TOOL_ITERATION_LIMIT_EXCEEDED',
    'FRONTEND_TOOL_UNAVAILABLE',
    'AUTHENTICATION_REQUIRED',
    'PERMISSION_DENIED',
    'TENANT_MISMATCH',
    'POLICY_DENIED',
    'BUSINESS_RULE_DENIED',
    'PII_POLICY_DENIED',
    'APPROVAL_REQUIRED',
    'APPROVAL_REJECTED',
    'APPROVAL_EXPIRED',
    'SOURCE_LOAD_FAILED',
    'PARSE_FAILED',
    'CHUNK_FAILED',
    'EMBEDDING_FAILED',
    'VECTOR_STORE_FAILED',
    'INDEX_FAILED',
    'RETRIEVAL_FAILED',
    'MEMORY_WRITE_DENIED',
    'MEMORY_READ_DENIED',
    'AGENT_NOT_FOUND',
    'AGENT_DISABLED',
    'AGENT_INPUT_INVALID',
    'AGENT_OUTPUT_INVALID',
    'AGENT_ITERATION_LIMIT_EXCEEDED',
    'AGENT_TOOL_LIMIT_EXCEEDED',
    'AGENT_DELEGATION_LIMIT_EXCEEDED',
    'AGENT_DELEGATION_DEPTH_EXCEEDED',
    'AGENT_DELEGATION_DENIED',
    'AGENT_HANDOFF_TARGET_INVALID',
    'AGENT_ROUTING_FAILED',
    'AGENT_PLAN_INVALID',
    'AGENT_PLAN_STEP_FAILED',
    'AGENT_TIMEOUT',
    'AGENT_CANCELLED',
    'AGENT_EXECUTION_ERROR',
    'WORKFLOW_NOT_FOUND',
    'WORKFLOW_DEFINITION_INVALID',
    'WORKFLOW_INPUT_INVALID',
    'WORKFLOW_STEP_NOT_FOUND',
    'WORKFLOW_STEP_EXECUTION_ERROR',
    'WORKFLOW_STEP_TIMEOUT',
    'WORKFLOW_RETRY_EXHAUSTED',
    'WORKFLOW_COMPENSATION_FAILED',
    'WORKFLOW_CHECKPOINT_FAILED',
    'WORKFLOW_CHECKPOINT_NOT_FOUND',
    'WORKFLOW_CHECKPOINT_VERSION_MISMATCH',
    'WORKFLOW_RESUME_FAILED',
    'WORKFLOW_APPROVAL_EXPIRED',
    'WORKFLOW_CANCELLED',
    'WORKFLOW_DEAD_LETTERED',
  ]),
  message: z.string(),
  retryable: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const toolResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('success'), toolCallId: z.string().min(1), data: z.unknown() }),
  z.object({
    status: z.literal('error'),
    toolCallId: z.string().min(1),
    error: publicCopilotErrorSchema,
  }),
]);

const contentPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('tool_call'),
    toolCallId: z.string().min(1),
    name: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal('tool_result'),
    toolCallId: z.string().min(1),
    result: toolResultSchema,
  }),
]);

const messageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);

const toolSourceSchema = z.enum(['native', 'frontend', 'openapi', 'mcp', 'agent']);

const finishReasonSchema = z.enum([
  'stop',
  'length',
  'content_filter',
  'cancelled',
  'error',
  'unknown',
  'tool_calls',
]);

/** Common fields present on every event, regardless of whether `type` is recognized. */
const copilotEventBaseSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  threadId: z.string().min(1),
  sequence: z.number().int().positive(),
  timestamp: z.string().min(1),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  rootRunId: z.string().min(1).optional(),
  parentRunId: z.string().min(1).optional(),
});

const workflowStepTypeSchema = z.enum(['function', 'tool', 'agent', 'approval', 'condition', 'parallel']);
const workflowStepPhaseSchema = z.enum(['forward', 'compensation']);

const runStartedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('run.started'),
});

const runCompletedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('run.completed'),
  usage: usageSchema,
  finishReason: finishReasonSchema.optional(),
});

const runFailedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('run.failed'),
  error: publicCopilotErrorSchema,
});

const runCancelledEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('run.cancelled'),
});

const messageStartEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('message.started'),
  messageId: z.string().min(1),
  role: messageRoleSchema,
});

const messageDeltaEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('message.delta'),
  messageId: z.string().min(1),
  delta: z.string(),
});

const messageEndEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('message.end'),
  messageId: z.string().min(1),
  content: z.array(contentPartSchema),
});

const errorEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('error'),
  error: publicCopilotErrorSchema,
});

const toolCallRequestedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('tool.requested'),
  toolCallId: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
  source: toolSourceSchema,
});

const toolCallStartedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('tool.started'),
  toolCallId: z.string().min(1),
  name: z.string().min(1),
});

const toolCallCompletedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('tool.completed'),
  toolCallId: z.string().min(1),
  name: z.string().min(1),
  result: z.unknown(),
});

const toolCallFailedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('tool.failed'),
  toolCallId: z.string().min(1),
  name: z.string().min(1),
  error: publicCopilotErrorSchema,
});

const toolActionRiskSchema = z.enum(['read-only', 'write', 'destructive']);
const toolActionReversibilitySchema = z.enum(['reversible', 'compensatable', 'irreversible']);
const toolApprovalLevelSchema = z.enum([
  'none',
  'user-confirmation',
  'supervisor',
  'admin',
  'two-person',
]);

const toolChangePreviewSchema = z.object({
  field: z.string(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});

const toolActionPreviewSchema = z.object({
  summary: z.string(),
  changes: z.array(toolChangePreviewSchema).optional(),
  warnings: z.array(z.string()).optional(),
});

const approvalRequestedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('approval.requested'),
  approvalId: z.string().min(1),
  toolCallId: z.string().min(1),
  action: z.string().min(1),
  approvalLevel: toolApprovalLevelSchema,
  summary: z.string(),
  risk: toolActionRiskSchema.optional(),
  reversibility: toolActionReversibilitySchema.optional(),
  expiresAt: z.string().optional(),
  preview: toolActionPreviewSchema.optional(),
});

const approvalApprovedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('approval.approved'),
  approvalId: z.string().min(1),
  toolCallId: z.string().min(1),
  decidedBy: z.string().optional(),
});

const approvalRejectedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('approval.rejected'),
  approvalId: z.string().min(1),
  toolCallId: z.string().min(1),
  decidedBy: z.string().optional(),
  reason: z.string().optional(),
});

const approvalExpiredEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('approval.expired'),
  approvalId: z.string().min(1),
  toolCallId: z.string().min(1),
});

const agentRunStartedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('agent.run.started'),
  agentId: z.string().min(1),
  agentRunId: z.string().min(1),
});

const agentRunCompletedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('agent.run.completed'),
  agentId: z.string().min(1),
  agentRunId: z.string().min(1),
});

const agentRunFailedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('agent.run.failed'),
  agentId: z.string().min(1),
  agentRunId: z.string().min(1),
  error: publicCopilotErrorSchema,
});

const agentRunCancelledEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('agent.run.cancelled'),
  agentId: z.string().min(1),
  agentRunId: z.string().min(1),
});

const agentDelegationStartedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('agent.delegation.started'),
  fromAgentId: z.string().min(1),
  toAgentId: z.string().min(1),
  delegationId: z.string().min(1),
  depth: z.number().int().nonnegative(),
});

const agentDelegationCompletedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('agent.delegation.completed'),
  fromAgentId: z.string().min(1),
  toAgentId: z.string().min(1),
  delegationId: z.string().min(1),
  status: z.enum(['completed', 'failed']),
  error: publicCopilotErrorSchema.optional(),
});

const agentHandoffEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('agent.handoff'),
  fromAgentId: z.string().min(1),
  toAgentId: z.string().min(1),
  reason: z.string(),
});

const agentRoutingDecidedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('agent.routing.decided'),
  router: z.enum(['deterministic', 'model']),
  selectedAgentId: z.string().min(1),
  candidateAgentIds: z.array(z.string().min(1)),
  reasonCode: z.string().optional(),
});

const workflowRunStartedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('workflow.run.started'),
  workflowId: z.string().min(1),
  workflowRunId: z.string().min(1),
});

const workflowRunPausedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('workflow.run.paused'),
  workflowId: z.string().min(1),
  workflowRunId: z.string().min(1),
  reason: z.enum(['approval', 'checkpoint', 'manual', 'external-event']),
  stepId: z.string().min(1).optional(),
});

const workflowRunResumedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('workflow.run.resumed'),
  workflowId: z.string().min(1),
  workflowRunId: z.string().min(1),
});

const workflowRunCompletedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('workflow.run.completed'),
  workflowId: z.string().min(1),
  workflowRunId: z.string().min(1),
});

const workflowRunFailedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('workflow.run.failed'),
  workflowId: z.string().min(1),
  workflowRunId: z.string().min(1),
  error: publicCopilotErrorSchema,
});

const workflowRunCancelledEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('workflow.run.cancelled'),
  workflowId: z.string().min(1),
  workflowRunId: z.string().min(1),
});

const workflowStepStartedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('workflow.step.started'),
  workflowRunId: z.string().min(1),
  stepId: z.string().min(1),
  stepType: workflowStepTypeSchema,
  attempt: z.number().int().positive(),
  phase: workflowStepPhaseSchema.optional(),
});

const workflowStepCompletedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('workflow.step.completed'),
  workflowRunId: z.string().min(1),
  stepId: z.string().min(1),
  attempt: z.number().int().positive(),
  phase: workflowStepPhaseSchema.optional(),
});

const workflowStepFailedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('workflow.step.failed'),
  workflowRunId: z.string().min(1),
  stepId: z.string().min(1),
  attempt: z.number().int().positive(),
  phase: workflowStepPhaseSchema.optional(),
  error: publicCopilotErrorSchema,
  willRetry: z.boolean(),
});

const workflowCheckpointSavedEventSchema = copilotEventBaseSchema.extend({
  type: z.literal('workflow.checkpoint.saved'),
  workflowRunId: z.string().min(1),
  stepId: z.string().min(1),
  version: z.number().int().nonnegative(),
});

type EventSchemaFor<T extends CopilotEvent> = z.ZodType<T>;

const eventSchemasByType: {
  'run.started': EventSchemaFor<RunStartedEvent>;
  'run.completed': EventSchemaFor<RunCompletedEvent>;
  'run.failed': EventSchemaFor<RunFailedEvent>;
  'run.cancelled': EventSchemaFor<RunCancelledEvent>;
  'message.started': EventSchemaFor<MessageStartEvent>;
  'message.delta': EventSchemaFor<MessageDeltaEvent>;
  'message.end': EventSchemaFor<MessageEndEvent>;
  error: EventSchemaFor<ErrorEvent>;
  'tool.requested': EventSchemaFor<ToolCallRequestedEvent>;
  'tool.started': EventSchemaFor<ToolCallStartedEvent>;
  'tool.completed': EventSchemaFor<ToolCallCompletedEvent>;
  'tool.failed': EventSchemaFor<ToolCallFailedEvent>;
  'approval.requested': EventSchemaFor<ApprovalRequestedEvent>;
  'approval.approved': EventSchemaFor<ApprovalApprovedEvent>;
  'approval.rejected': EventSchemaFor<ApprovalRejectedEvent>;
  'approval.expired': EventSchemaFor<ApprovalExpiredEvent>;
  'agent.run.started': EventSchemaFor<AgentRunStartedEvent>;
  'agent.run.completed': EventSchemaFor<AgentRunCompletedEvent>;
  'agent.run.failed': EventSchemaFor<AgentRunFailedEvent>;
  'agent.run.cancelled': EventSchemaFor<AgentRunCancelledEvent>;
  'agent.delegation.started': EventSchemaFor<AgentDelegationStartedEvent>;
  'agent.delegation.completed': EventSchemaFor<AgentDelegationCompletedEvent>;
  'agent.handoff': EventSchemaFor<AgentHandoffEvent>;
  'agent.routing.decided': EventSchemaFor<AgentRoutingDecidedEvent>;
  'workflow.run.started': EventSchemaFor<WorkflowRunStartedEvent>;
  'workflow.run.paused': EventSchemaFor<WorkflowRunPausedEvent>;
  'workflow.run.resumed': EventSchemaFor<WorkflowRunResumedEvent>;
  'workflow.run.completed': EventSchemaFor<WorkflowRunCompletedEvent>;
  'workflow.run.failed': EventSchemaFor<WorkflowRunFailedEvent>;
  'workflow.run.cancelled': EventSchemaFor<WorkflowRunCancelledEvent>;
  'workflow.step.started': EventSchemaFor<WorkflowStepStartedEvent>;
  'workflow.step.completed': EventSchemaFor<WorkflowStepCompletedEvent>;
  'workflow.step.failed': EventSchemaFor<WorkflowStepFailedEvent>;
  'workflow.checkpoint.saved': EventSchemaFor<WorkflowCheckpointSavedEvent>;
} = {
  'run.started': runStartedEventSchema,
  'run.completed': runCompletedEventSchema,
  'run.failed': runFailedEventSchema,
  'run.cancelled': runCancelledEventSchema,
  'message.started': messageStartEventSchema,
  'message.delta': messageDeltaEventSchema,
  'message.end': messageEndEventSchema,
  error: errorEventSchema,
  'tool.requested': toolCallRequestedEventSchema,
  'tool.started': toolCallStartedEventSchema,
  'tool.completed': toolCallCompletedEventSchema,
  'tool.failed': toolCallFailedEventSchema,
  'approval.requested': approvalRequestedEventSchema,
  'approval.approved': approvalApprovedEventSchema,
  'approval.rejected': approvalRejectedEventSchema,
  'approval.expired': approvalExpiredEventSchema,
  'agent.run.started': agentRunStartedEventSchema,
  'agent.run.completed': agentRunCompletedEventSchema,
  'agent.run.failed': agentRunFailedEventSchema,
  'agent.run.cancelled': agentRunCancelledEventSchema,
  'agent.delegation.started': agentDelegationStartedEventSchema,
  'agent.delegation.completed': agentDelegationCompletedEventSchema,
  'agent.handoff': agentHandoffEventSchema,
  'agent.routing.decided': agentRoutingDecidedEventSchema,
  'workflow.run.started': workflowRunStartedEventSchema,
  'workflow.run.paused': workflowRunPausedEventSchema,
  'workflow.run.resumed': workflowRunResumedEventSchema,
  'workflow.run.completed': workflowRunCompletedEventSchema,
  'workflow.run.failed': workflowRunFailedEventSchema,
  'workflow.run.cancelled': workflowRunCancelledEventSchema,
  'workflow.step.started': workflowStepStartedEventSchema,
  'workflow.step.completed': workflowStepCompletedEventSchema,
  'workflow.step.failed': workflowStepFailedEventSchema,
  'workflow.checkpoint.saved': workflowCheckpointSavedEventSchema,
};

function isKnownEventType(value: string): value is CopilotEventType {
  return Object.prototype.hasOwnProperty.call(eventSchemasByType, value);
}

/**
 * Result of parsing a value that arrived over the wire as a candidate protocol event.
 * Three-way discriminated so a consumer can switch exhaustively (see typescript-standards):
 *  - `known`   - matched a recognized event type and passed full validation.
 *  - `unknown` - base envelope is valid but `type` is not one this build recognizes; safe
 *                to ignore (forward compatibility - see events.ts).
 *  - `invalid` - malformed: either the base envelope is broken, or `type` is recognized but
 *                the type-specific payload failed validation. Never silently coerced.
 */
export type ParsedEvent =
  | { readonly kind: 'known'; readonly event: CopilotEvent }
  | { readonly kind: 'unknown'; readonly event: UnknownCopilotEvent }
  | { readonly kind: 'invalid'; readonly error: CopilotError };

export function parseEvent(input: unknown): ParsedEvent {
  const baseResult = copilotEventBaseSchema.safeParse(input);
  if (!baseResult.success) {
    return {
      kind: 'invalid',
      error: CopilotError.validation('Malformed protocol event: invalid base envelope', {
        issueCount: baseResult.error.issues.length,
      }),
    };
  }

  const rawType = (input as { type?: unknown }).type;
  if (typeof rawType !== 'string' || rawType.length === 0) {
    return {
      kind: 'invalid',
      error: CopilotError.validation('Malformed protocol event: "type" must be a non-empty string'),
    };
  }

  if (!isKnownEventType(rawType)) {
    return {
      kind: 'unknown',
      event: { ...baseResult.data, type: rawType },
    };
  }

  const schema = eventSchemasByType[rawType];
  const result = schema.safeParse(input);
  if (!result.success) {
    return {
      kind: 'invalid',
      error: CopilotError.validation(`Malformed "${rawType}" event`, {
        issueCount: result.error.issues.length,
      }),
    };
  }

  return { kind: 'known', event: result.data };
}

/**
 * Events only ever contain JSON-safe primitives, so plain JSON.stringify is sufficient -
 * this function exists as the single, explicit place that policy is enforced/documented,
 * rather than every caller reaching for JSON.stringify directly.
 */
export function serializeEvent(event: CopilotEvent): string {
  return JSON.stringify(event);
}
