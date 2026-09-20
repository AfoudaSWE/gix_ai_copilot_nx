import { describe, expect, it } from 'vitest';
import { CopilotError } from '@gixcopilot/protocol';
import { normalizeExecutionError, normalizeHttpError } from './error-normalization.js';
import type { ErrorNormalizationContext } from './error-normalization.js';
import type { HttpExecutionResult } from './http-executor.js';

const context: ErrorNormalizationContext = {
  integrationId: 'vas',
  toolName: 'vas.applications.get',
  method: 'get',
  path: '/applications/{id}',
};

function response(status: number, body: unknown = { message: 'error' }): HttpExecutionResult {
  return { status, headers: {}, body };
}

describe('normalizeHttpError', () => {
  it('maps 429 to RATE_LIMITED and marks it retryable', () => {
    const error = normalizeHttpError(response(429), context);
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.retryable).toBe(true);
  });

  it('maps 401 to TOOL_EXECUTION_ERROR, never AUTHENTICATION_ERROR or AUTHENTICATION_REQUIRED', () => {
    const error = normalizeHttpError(response(401), context);
    expect(error.code).toBe('TOOL_EXECUTION_ERROR');
    expect(error.code).not.toBe('AUTHENTICATION_ERROR');
    expect(error.code).not.toBe('AUTHENTICATION_REQUIRED');
    expect(error.metadata?.['external']).toBe(true);
    expect(error.metadata?.['httpStatus']).toBe(401);
  });

  it('maps 403 to TOOL_EXECUTION_ERROR, never PERMISSION_DENIED (the Action Firewall code)', () => {
    const error = normalizeHttpError(response(403), context);
    expect(error.code).toBe('TOOL_EXECUTION_ERROR');
    expect(error.code).not.toBe('PERMISSION_DENIED');
    expect(error.metadata?.['external']).toBe(true);
  });

  it('maps 404, 409, 422, and 5xx to TOOL_EXECUTION_ERROR with the status in metadata', () => {
    for (const status of [404, 409, 422, 500, 503]) {
      const error = normalizeHttpError(response(status), context);
      expect(error.code).toBe('TOOL_EXECUTION_ERROR');
      expect(error.metadata?.['httpStatus']).toBe(status);
    }
  });

  it('redacts sensitive response headers in the error metadata', () => {
    const error = normalizeHttpError(
      { status: 401, headers: { 'set-cookie': 'session=abc', 'content-type': 'application/json' }, body: {} },
      context,
    );
    const headers = error.metadata?.['responseHeaders'] as Record<string, string>;
    expect(headers['set-cookie']).toBe('[REDACTED]');
    expect(headers['content-type']).toBe('application/json');
  });

  it('omits untrusted error response bodies', () => {
    const error = normalizeHttpError(response(500, 'x'.repeat(2000)), context);
    expect(error.metadata?.['responseBody']).toBeUndefined();
  });
});

describe('normalizeExecutionError', () => {
  it('passes an already-normalized CopilotError through unchanged', () => {
    const original = CopilotError.validation('bad input');
    expect(normalizeExecutionError(original, context)).toBe(original);
  });

  it('maps an AbortError DOMException to CANCELLED', () => {
    const error = normalizeExecutionError(new DOMException('Aborted', 'AbortError'), context);
    expect(error.code).toBe('CANCELLED');
  });

  it('maps a TimeoutError DOMException to TIMEOUT', () => {
    const error = normalizeExecutionError(new DOMException('Timed out', 'TimeoutError'), context);
    expect(error.code).toBe('TIMEOUT');
  });

  it('maps a generic Error to NETWORK_ERROR', () => {
    const error = normalizeExecutionError(new TypeError('fetch failed'), context);
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.retryable).toBe(true);
  });

  it('maps a non-Error throw to INTERNAL_ERROR', () => {
    const error = normalizeExecutionError('a string was thrown', context);
    expect(error.code).toBe('INTERNAL_ERROR');
  });
});
