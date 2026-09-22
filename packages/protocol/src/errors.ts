/**
 * Normalized protocol-level error taxonomy. The MODEL_ERROR..NETWORK_ERROR codes were added
 * in Phase 2 (see docs/adr/0006-model-provider-abstraction.md) once an LLM runtime existed
 * to normalize provider failures into - a provider adapter's job is to map its raw errors
 * onto this fixed set, never to invent new codes of its own (see the ai-runtime skill).
 */
export type CopilotErrorCode =
  | 'PROTOCOL_ERROR'
  | 'VALIDATION_ERROR'
  | 'TRANSPORT_ERROR'
  | 'CANCELLED'
  | 'INTERNAL_ERROR'
  | 'MODEL_ERROR'
  | 'PROVIDER_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'RATE_LIMITED'
  | 'MODEL_NOT_FOUND'
  | 'CONTEXT_LIMIT_EXCEEDED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  /**
   * Added in Phase 5 (tools) - a provider-neutral tool-call error taxonomy alongside the
   * model-error codes above. Argument/output shape problems reuse VALIDATION_ERROR rather
   * than inventing parallel codes for the same failure class - see the tool-system skill.
   */
  | 'TOOL_NOT_FOUND'
  | 'TOOL_DISABLED'
  | 'TOOL_EXECUTION_ERROR'
  | 'TOOL_OUTPUT_INVALID'
  | 'TOOL_ITERATION_LIMIT_EXCEEDED'
  | 'FRONTEND_TOOL_UNAVAILABLE'
  /**
   * Added in Phase 7 (security) - the AI Action Firewall's stable reason codes (Section 61).
   * These surface as an ordinary `tool.failed` event's `error.code` (Section 62's "reuse
   * existing events" guidance) rather than inventing a parallel denial event type.
   */
  | 'AUTHENTICATION_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'TENANT_MISMATCH'
  | 'POLICY_DENIED'
  | 'BUSINESS_RULE_DENIED'
  | 'PII_POLICY_DENIED'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_REJECTED'
  | 'APPROVAL_EXPIRED'
  /**
   * Added in Phase 9 (knowledge/RAG/memory) - a normalized taxonomy for the ingestion and
   * retrieval pipeline (Section 129). ACL/tenant denial deliberately reuses the existing
   * PERMISSION_DENIED/TENANT_MISMATCH codes above rather than adding a duplicate ACCESS_DENIED
   * code for the same failure class - see the dependency-policy skill's "avoid duplication"
   * rule.
   */
  | 'SOURCE_LOAD_FAILED'
  | 'PARSE_FAILED'
  | 'CHUNK_FAILED'
  | 'EMBEDDING_FAILED'
  | 'VECTOR_STORE_FAILED'
  | 'INDEX_FAILED'
  | 'RETRIEVAL_FAILED'
  | 'MEMORY_WRITE_DENIED'
  | 'MEMORY_READ_DENIED'
  /**
   * Added in Phase 10 (agents) - the agent runtime's normalized error taxonomy. Delegation/
   * handoff/routing denials are distinct codes (not a reuse of PERMISSION_DENIED) because
   * they represent an agent-graph/authorization-boundary decision made by the agent runtime
   * itself, before a tool call - and therefore before the Action Firewall - is ever reached;
   * an actual tool denial inside a delegated call still surfaces as PERMISSION_DENIED/
   * POLICY_DENIED exactly as it does today (see the agent-architecture skill).
   */
  | 'AGENT_NOT_FOUND'
  | 'AGENT_DISABLED'
  | 'AGENT_INPUT_INVALID'
  | 'AGENT_OUTPUT_INVALID'
  | 'AGENT_ITERATION_LIMIT_EXCEEDED'
  | 'AGENT_TOOL_LIMIT_EXCEEDED'
  | 'AGENT_DELEGATION_LIMIT_EXCEEDED'
  | 'AGENT_DELEGATION_DEPTH_EXCEEDED'
  | 'AGENT_DELEGATION_DENIED'
  | 'AGENT_HANDOFF_TARGET_INVALID'
  | 'AGENT_ROUTING_FAILED'
  | 'AGENT_PLAN_INVALID'
  | 'AGENT_PLAN_STEP_FAILED'
  | 'AGENT_TIMEOUT'
  | 'AGENT_CANCELLED'
  | 'AGENT_EXECUTION_ERROR'
  /**
   * Added in Phase 10 (workflows) - the workflow engine's normalized error taxonomy.
   * Consequential workflow steps (tool/approval steps) still raise the exact Phase 5/7 codes
   * above when the Action Firewall itself denies them - these codes cover workflow-engine-
   * level failures (definition, retry exhaustion, checkpoint persistence, cancellation), not
   * a second authorization system (see the redis-jobs and hitl skills).
   */
  | 'WORKFLOW_NOT_FOUND'
  | 'WORKFLOW_DEFINITION_INVALID'
  | 'WORKFLOW_INPUT_INVALID'
  | 'WORKFLOW_STEP_NOT_FOUND'
  | 'WORKFLOW_STEP_EXECUTION_ERROR'
  | 'WORKFLOW_STEP_TIMEOUT'
  | 'WORKFLOW_RETRY_EXHAUSTED'
  | 'WORKFLOW_COMPENSATION_FAILED'
  | 'WORKFLOW_CHECKPOINT_FAILED'
  | 'WORKFLOW_CHECKPOINT_NOT_FOUND'
  | 'WORKFLOW_CHECKPOINT_VERSION_MISMATCH'
  | 'WORKFLOW_RESUME_FAILED'
  | 'WORKFLOW_APPROVAL_EXPIRED'
  | 'WORKFLOW_CANCELLED'
  | 'WORKFLOW_DEAD_LETTERED';

export type CopilotErrorMetadata = Readonly<Record<string, unknown>>;

export interface CopilotErrorOptions {
  readonly retryable?: boolean;
  readonly cause?: unknown;
  readonly metadata?: CopilotErrorMetadata;
}

/**
 * The safe-to-serialize projection of a CopilotError. Deliberately excludes `cause`, which
 * may wrap a raw internal/provider error (stack trace, connection string, etc.) - see the
 * security skill's rule against leaking internal detail to a client or into model context.
 */
export interface PublicCopilotError {
  readonly code: CopilotErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly metadata?: CopilotErrorMetadata;
}

export class CopilotError extends Error {
  override readonly name = 'CopilotError';
  readonly code: CopilotErrorCode;
  readonly retryable: boolean;
  readonly metadata?: CopilotErrorMetadata;

  constructor(code: CopilotErrorCode, message: string, options: CopilotErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.metadata = options.metadata;
  }

  toPublicJSON(): PublicCopilotError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.metadata !== undefined ? { metadata: this.metadata } : {}),
    };
  }

  static isCopilotError(value: unknown): value is CopilotError {
    return value instanceof CopilotError;
  }

  static validation(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('VALIDATION_ERROR', message, { retryable: false, metadata });
  }

  static protocol(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('PROTOCOL_ERROR', message, { retryable: false, metadata });
  }

  static transport(message: string, cause?: unknown, retryable = true): CopilotError {
    return new CopilotError('TRANSPORT_ERROR', message, { retryable, cause });
  }

  static cancelled(message = 'The run was cancelled.'): CopilotError {
    return new CopilotError('CANCELLED', message, { retryable: false });
  }

  static internal(message: string, cause?: unknown): CopilotError {
    return new CopilotError('INTERNAL_ERROR', message, { retryable: false, cause });
  }

  static model(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('MODEL_ERROR', message, { retryable: false, metadata });
  }

  static provider(
    message: string,
    metadata?: CopilotErrorMetadata,
    retryable = false,
  ): CopilotError {
    return new CopilotError('PROVIDER_ERROR', message, { retryable, metadata });
  }

  static authentication(message = 'Provider authentication failed.'): CopilotError {
    return new CopilotError('AUTHENTICATION_ERROR', message, { retryable: false });
  }

  static rateLimited(
    message = 'Provider rate limit exceeded.',
    metadata?: CopilotErrorMetadata,
  ): CopilotError {
    return new CopilotError('RATE_LIMITED', message, { retryable: true, metadata });
  }

  static modelNotFound(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('MODEL_NOT_FOUND', message, { retryable: false, metadata });
  }

  static contextLimitExceeded(message = 'The model context limit was exceeded.'): CopilotError {
    return new CopilotError('CONTEXT_LIMIT_EXCEEDED', message, { retryable: false });
  }

  static timeout(message = 'The request timed out.'): CopilotError {
    return new CopilotError('TIMEOUT', message, { retryable: true });
  }

  static networkError(message: string, cause?: unknown): CopilotError {
    return new CopilotError('NETWORK_ERROR', message, { retryable: true, cause });
  }

  static toolNotFound(name: string): CopilotError {
    return new CopilotError('TOOL_NOT_FOUND', `No tool is registered with the name "${name}".`, {
      retryable: false,
      metadata: { name },
    });
  }

  static toolDisabled(name: string): CopilotError {
    return new CopilotError('TOOL_DISABLED', `Tool "${name}" is currently disabled.`, {
      retryable: false,
      metadata: { name },
    });
  }

  static toolExecutionError(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('TOOL_EXECUTION_ERROR', message, { retryable: false, metadata });
  }

  static toolOutputInvalid(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('TOOL_OUTPUT_INVALID', message, { retryable: false, metadata });
  }

  static toolIterationLimitExceeded(limit: number): CopilotError {
    return new CopilotError(
      'TOOL_ITERATION_LIMIT_EXCEEDED',
      `The model requested more than ${limit} tool-calling round(s) in a single run.`,
      { retryable: false, metadata: { limit } },
    );
  }

  static frontendToolUnavailable(name: string): CopilotError {
    return new CopilotError(
      'FRONTEND_TOOL_UNAVAILABLE',
      `Frontend tool "${name}" did not return a result (client disconnected or timed out).`,
      { retryable: false, metadata: { name } },
    );
  }

  static authenticationRequired(message = 'This action requires an authenticated identity.'): CopilotError {
    return new CopilotError('AUTHENTICATION_REQUIRED', message, { retryable: false });
  }

  static permissionDenied(action: string, missing?: readonly string[]): CopilotError {
    return new CopilotError(
      'PERMISSION_DENIED',
      `You do not have permission to perform "${action}".`,
      { retryable: false, metadata: missing ? { action, missing } : { action } },
    );
  }

  static tenantMismatch(message = 'This action is not permitted for your tenant.'): CopilotError {
    return new CopilotError('TENANT_MISMATCH', message, { retryable: false });
  }

  static policyDenied(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('POLICY_DENIED', message, { retryable: false, metadata });
  }

  static businessRuleDenied(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('BUSINESS_RULE_DENIED', message, { retryable: false, metadata });
  }

  static piiPolicyDenied(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('PII_POLICY_DENIED', message, { retryable: false, metadata });
  }

  static approvalRequired(level: string, approvalId: string): CopilotError {
    return new CopilotError(
      'APPROVAL_REQUIRED',
      `This action requires ${level} approval before it can execute.`,
      { retryable: false, metadata: { level, approvalId } },
    );
  }

  static approvalRejected(message = 'The requested action was not approved.'): CopilotError {
    return new CopilotError('APPROVAL_REJECTED', message, { retryable: false });
  }

  static approvalExpired(message = 'The approval request expired before a decision was made.'): CopilotError {
    return new CopilotError('APPROVAL_EXPIRED', message, { retryable: false });
  }

  static sourceLoadFailed(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('SOURCE_LOAD_FAILED', message, { retryable: true, metadata });
  }

  static parseFailed(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('PARSE_FAILED', message, { retryable: false, metadata });
  }

  static chunkFailed(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('CHUNK_FAILED', message, { retryable: false, metadata });
  }

  static embeddingFailed(
    message: string,
    metadata?: CopilotErrorMetadata,
    retryable = true,
  ): CopilotError {
    return new CopilotError('EMBEDDING_FAILED', message, { retryable, metadata });
  }

  static vectorStoreFailed(
    message: string,
    metadata?: CopilotErrorMetadata,
    retryable = true,
  ): CopilotError {
    return new CopilotError('VECTOR_STORE_FAILED', message, { retryable, metadata });
  }

  static indexFailed(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('INDEX_FAILED', message, { retryable: false, metadata });
  }

  static retrievalFailed(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('RETRIEVAL_FAILED', message, { retryable: true, metadata });
  }

  static memoryWriteDenied(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('MEMORY_WRITE_DENIED', message, { retryable: false, metadata });
  }

  static memoryReadDenied(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('MEMORY_READ_DENIED', message, { retryable: false, metadata });
  }

  static agentNotFound(agentId: string): CopilotError {
    return new CopilotError('AGENT_NOT_FOUND', `No agent is registered with id "${agentId}".`, {
      retryable: false,
      metadata: { agentId },
    });
  }

  static agentDisabled(agentId: string): CopilotError {
    return new CopilotError('AGENT_DISABLED', `Agent "${agentId}" is currently disabled.`, {
      retryable: false,
      metadata: { agentId },
    });
  }

  static agentInputInvalid(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('AGENT_INPUT_INVALID', message, { retryable: false, metadata });
  }

  static agentOutputInvalid(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('AGENT_OUTPUT_INVALID', message, { retryable: false, metadata });
  }

  static agentIterationLimitExceeded(limit: number): CopilotError {
    return new CopilotError(
      'AGENT_ITERATION_LIMIT_EXCEEDED',
      `The agent exceeded its maximum of ${limit} iteration(s) in a single run.`,
      { retryable: false, metadata: { limit } },
    );
  }

  static agentToolLimitExceeded(limit: number): CopilotError {
    return new CopilotError(
      'AGENT_TOOL_LIMIT_EXCEEDED',
      `The agent exceeded its maximum of ${limit} tool call(s) in a single run.`,
      { retryable: false, metadata: { limit } },
    );
  }

  static agentDelegationLimitExceeded(limit: number): CopilotError {
    return new CopilotError(
      'AGENT_DELEGATION_LIMIT_EXCEEDED',
      `The agent exceeded its maximum of ${limit} delegation(s) in a single run.`,
      { retryable: false, metadata: { limit } },
    );
  }

  static agentDelegationDepthExceeded(limit: number): CopilotError {
    return new CopilotError(
      'AGENT_DELEGATION_DEPTH_EXCEEDED',
      `Delegation exceeded the maximum allowed depth of ${limit}.`,
      { retryable: false, metadata: { limit } },
    );
  }

  static agentDelegationDenied(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('AGENT_DELEGATION_DENIED', message, { retryable: false, metadata });
  }

  static agentHandoffTargetInvalid(fromAgentId: string, toAgentId: string): CopilotError {
    return new CopilotError(
      'AGENT_HANDOFF_TARGET_INVALID',
      `Agent "${fromAgentId}" is not permitted to hand off to "${toAgentId}".`,
      { retryable: false, metadata: { fromAgentId, toAgentId } },
    );
  }

  static agentRoutingFailed(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('AGENT_ROUTING_FAILED', message, { retryable: false, metadata });
  }

  static agentPlanInvalid(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('AGENT_PLAN_INVALID', message, { retryable: false, metadata });
  }

  static agentPlanStepFailed(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('AGENT_PLAN_STEP_FAILED', message, { retryable: false, metadata });
  }

  static agentTimeout(message = 'The agent run timed out.'): CopilotError {
    return new CopilotError('AGENT_TIMEOUT', message, { retryable: false });
  }

  static agentCancelled(message = 'The agent run was cancelled.'): CopilotError {
    return new CopilotError('AGENT_CANCELLED', message, { retryable: false });
  }

  static agentExecutionError(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('AGENT_EXECUTION_ERROR', message, { retryable: false, metadata });
  }

  static workflowNotFound(workflowId: string): CopilotError {
    return new CopilotError(
      'WORKFLOW_NOT_FOUND',
      `No workflow is registered with id "${workflowId}".`,
      { retryable: false, metadata: { workflowId } },
    );
  }

  static workflowDefinitionInvalid(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('WORKFLOW_DEFINITION_INVALID', message, { retryable: false, metadata });
  }

  static workflowInputInvalid(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('WORKFLOW_INPUT_INVALID', message, { retryable: false, metadata });
  }

  static workflowStepNotFound(stepId: string): CopilotError {
    return new CopilotError(
      'WORKFLOW_STEP_NOT_FOUND',
      `No step is defined with id "${stepId}".`,
      { retryable: false, metadata: { stepId } },
    );
  }

  static workflowStepExecutionError(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('WORKFLOW_STEP_EXECUTION_ERROR', message, { retryable: false, metadata });
  }

  static workflowStepTimeout(stepId: string): CopilotError {
    return new CopilotError(
      'WORKFLOW_STEP_TIMEOUT',
      `Step "${stepId}" timed out.`,
      { retryable: true, metadata: { stepId } },
    );
  }

  static workflowRetryExhausted(stepId: string, attempts: number): CopilotError {
    return new CopilotError(
      'WORKFLOW_RETRY_EXHAUSTED',
      `Step "${stepId}" failed after ${attempts} attempt(s) and moved to the dead-letter queue.`,
      { retryable: false, metadata: { stepId, attempts } },
    );
  }

  static workflowCompensationFailed(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('WORKFLOW_COMPENSATION_FAILED', message, { retryable: false, metadata });
  }

  static workflowCheckpointFailed(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('WORKFLOW_CHECKPOINT_FAILED', message, { retryable: true, metadata });
  }

  static workflowCheckpointNotFound(workflowRunId: string): CopilotError {
    return new CopilotError(
      'WORKFLOW_CHECKPOINT_NOT_FOUND',
      `No checkpoint exists for workflow run "${workflowRunId}".`,
      { retryable: false, metadata: { workflowRunId } },
    );
  }

  static workflowCheckpointVersionMismatch(
    workflowRunId: string,
    expected: number,
    actual: number,
  ): CopilotError {
    return new CopilotError(
      'WORKFLOW_CHECKPOINT_VERSION_MISMATCH',
      `Checkpoint for workflow run "${workflowRunId}" was expected at version ${expected} but is at ${actual}.`,
      { retryable: false, metadata: { workflowRunId, expected, actual } },
    );
  }

  static workflowResumeFailed(message: string, metadata?: CopilotErrorMetadata): CopilotError {
    return new CopilotError('WORKFLOW_RESUME_FAILED', message, { retryable: false, metadata });
  }

  static workflowApprovalExpired(message = 'The workflow approval expired before a decision was made.'): CopilotError {
    return new CopilotError('WORKFLOW_APPROVAL_EXPIRED', message, { retryable: false });
  }

  static workflowCancelled(message = 'The workflow run was cancelled.'): CopilotError {
    return new CopilotError('WORKFLOW_CANCELLED', message, { retryable: false });
  }

  static workflowDeadLettered(stepId: string): CopilotError {
    return new CopilotError(
      'WORKFLOW_DEAD_LETTERED',
      `Step "${stepId}" was moved to the dead-letter queue.`,
      { retryable: false, metadata: { stepId } },
    );
  }
}
