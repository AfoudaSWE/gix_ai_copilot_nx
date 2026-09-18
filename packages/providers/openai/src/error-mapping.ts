import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  RateLimitError,
} from 'openai';
import { CopilotError } from '@aicopilot/protocol';
import type { FinishReason } from '@aicopilot/protocol';

/**
 * Maps the OpenAI SDK's own error hierarchy onto the shared CopilotError taxonomy
 * (Section 26/43). Nothing OpenAI-specific (status codes, `error.code` strings, the SDK's
 * own error classes) ever crosses this boundary - only a normalized CopilotError does.
 */
export function toNormalizedError(error: unknown): CopilotError {
  if (CopilotError.isCopilotError(error)) {
    return error;
  }
  if (error instanceof APIUserAbortError) {
    return CopilotError.cancelled();
  }
  if (error instanceof AuthenticationError) {
    return CopilotError.authentication(error.message);
  }
  if (error instanceof RateLimitError) {
    return CopilotError.rateLimited(error.message);
  }
  if (error instanceof NotFoundError) {
    return CopilotError.modelNotFound(error.message, { requestId: error.requestID ?? undefined });
  }
  if (error instanceof BadRequestError) {
    if (error.code === 'context_length_exceeded') {
      return CopilotError.contextLimitExceeded(error.message);
    }
    return CopilotError.model(error.message, { code: error.code ?? undefined });
  }
  if (error instanceof APIConnectionTimeoutError) {
    return CopilotError.timeout(error.message);
  }
  if (error instanceof APIConnectionError) {
    return CopilotError.networkError(error.message, error);
  }
  if (error instanceof APIError) {
    const retryable = typeof error.status === 'number' && error.status >= 500;
    return CopilotError.provider(error.message, { status: error.status ?? undefined }, retryable);
  }
  if (error instanceof Error) {
    return CopilotError.provider(error.message, undefined, false);
  }
  return CopilotError.provider('Unknown OpenAI provider error', { error: String(error) });
}

/** OpenAI's finish_reason vocabulary, normalized to the shared FinishReason (Section 28). */
export function mapFinishReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    case 'tool_calls':
    case 'function_call':
      // Tool calling is Phase 5 - this build never requests it, so this case shouldn't
      // occur in practice; if it does, "unknown" is safer than inventing a category.
      return 'unknown';
    case null:
    case undefined:
      return 'unknown';
    default:
      return 'unknown';
  }
}
