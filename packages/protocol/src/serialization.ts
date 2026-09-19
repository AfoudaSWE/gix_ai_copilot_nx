import { z } from 'zod';
import { CopilotError } from './errors.js';
import { PROTOCOL_VERSION } from './version.js';
import type {
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
});

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
