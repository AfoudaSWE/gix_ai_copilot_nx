import { CopilotError } from '@gixcopilot/protocol';
import { redactSensitiveHeaders } from '@gixcopilot/tools';
import type { HttpExecutionResult } from './http-executor.js';

export interface ErrorNormalizationContext {
  readonly integrationId: string;
  readonly toolName: string;
  readonly method: string;
  readonly path: string;
}

/**
 * Normalizes a non-2xx HTTP response into the SDK's existing `CopilotError` taxonomy (Section
 * 53), never a bespoke OpenAPI-specific error type - so a generated tool's failures surface to
 * `@gixcopilot/server`'s dispatch pipeline exactly like any hand-written tool's.
 *
 * Critically, this never reuses `AUTHENTICATION_REQUIRED`/`PERMISSION_DENIED` (the AI Action
 * Firewall's own codes, Phase 7) or `AUTHENTICATION_ERROR` (the model provider's own code) for
 * a 401/403 that came back from the *external* API (Section 54) - by the time this function
 * runs, the Action Firewall has already allowed the call; an external 401/403 is a completely
 * separate failure and is represented as `TOOL_EXECUTION_ERROR` with `external: true` metadata,
 * so the two authorization layers are never conflated in logs, traces, or the error a
 * developer sees. `429` reuses `RATE_LIMITED` - that code has no Action-Firewall-specific
 * meaning, so no such ambiguity exists there.
 */
export function normalizeHttpError(response: HttpExecutionResult, context: ErrorNormalizationContext): CopilotError {
  const metadata = {
    integrationId: context.integrationId,
    tool: context.toolName,
    method: context.method,
    path: context.path,
    httpStatus: response.status,
    external: true,
    responseHeaders: redactSensitiveHeaders(response.headers),
  };

  if (response.status === 429) {
    return CopilotError.rateLimited(
      `External API rate limit exceeded (429) calling "${context.toolName}".`,
      metadata,
    );
  }
  if (response.status === 401) {
    return CopilotError.toolExecutionError(
      `External API authentication failed (401 Unauthorized) calling "${context.toolName}" - this is the integration's own credential, separate from AI Action Firewall authorization.`,
      metadata,
    );
  }
  if (response.status === 403) {
    return CopilotError.toolExecutionError(
      `External API denied the request (403 Forbidden) calling "${context.toolName}" - this is the integration's own authorization, separate from AI Action Firewall authorization.`,
      metadata,
    );
  }
  if (response.status === 404) {
    return CopilotError.toolExecutionError(`External API resource not found (404) calling "${context.toolName}".`, metadata);
  }
  if (response.status === 409) {
    return CopilotError.toolExecutionError(`External API conflict (409) calling "${context.toolName}".`, metadata);
  }
  if (response.status === 422) {
    return CopilotError.toolExecutionError(
      `External API rejected the request as unprocessable (422) calling "${context.toolName}".`,
      metadata,
    );
  }
  if (response.status >= 500) {
    return CopilotError.toolExecutionError(
      `External API returned a server error (${String(response.status)}) calling "${context.toolName}".`,
      metadata,
    );
  }
  return CopilotError.toolExecutionError(
    `External API returned an unexpected status (${String(response.status)}) calling "${context.toolName}".`,
    metadata,
  );
}

/**
 * Normalizes a thrown error from the HTTP executor itself (network failure, timeout,
 * cancellation, or an invalid/unparseable response) - as opposed to `normalizeHttpError`,
 * which handles a well-formed non-2xx HTTP response.
 */
export function normalizeExecutionError(error: unknown, context: ErrorNormalizationContext): CopilotError {
  if (CopilotError.isCopilotError(error)) return error;

  if (error instanceof DOMException && error.name === 'AbortError') {
    return CopilotError.cancelled(`Call to "${context.toolName}" was cancelled or timed out.`);
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return CopilotError.timeout(`Call to "${context.toolName}" timed out.`);
  }
  if (error instanceof Error) {
    return CopilotError.networkError(`Network failure calling "${context.toolName}".`);
  }
  return CopilotError.internal(`Unexpected error calling "${context.toolName}".`);
}
