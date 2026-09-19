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
  | 'APPROVAL_EXPIRED';

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
}
