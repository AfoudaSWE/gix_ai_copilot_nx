/**
 * Normalized protocol-level error taxonomy. Provider/model error categories are explicitly
 * out of scope for Phase 1 - see the ai-runtime skill for where those get normalized once
 * an LLM runtime exists.
 */
export type CopilotErrorCode =
  'PROTOCOL_ERROR' | 'VALIDATION_ERROR' | 'TRANSPORT_ERROR' | 'CANCELLED' | 'INTERNAL_ERROR';

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
}
