import { describe, expect, it } from 'vitest';
import { CopilotError } from './errors.js';

describe('CopilotError', () => {
  it('exposes code, message, and a default non-retryable flag', () => {
    const error = CopilotError.validation('bad input');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('bad input');
    expect(error.retryable).toBe(false);
  });

  it('marks transport errors retryable by default', () => {
    const error = CopilotError.transport('upstream timed out');
    expect(error.code).toBe('TRANSPORT_ERROR');
    expect(error.retryable).toBe(true);
  });

  it('toPublicJSON never includes the internal cause', () => {
    const internalCause = new Error('raw pg connection string leaked here');
    const error = CopilotError.internal('something broke', internalCause);
    const publicJson = error.toPublicJSON();

    expect(publicJson).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'something broke',
      retryable: false,
    });
    expect(JSON.stringify(publicJson)).not.toContain('pg connection string');
    // the cause is still reachable on the instance itself for server-side logging.
    expect(error.cause).toBe(internalCause);
  });

  it('isCopilotError narrows unknown values', () => {
    const error = CopilotError.cancelled();
    expect(CopilotError.isCopilotError(error)).toBe(true);
    expect(CopilotError.isCopilotError(new Error('plain'))).toBe(false);
    expect(CopilotError.isCopilotError(null)).toBe(false);
  });

  describe('Phase 2 model/provider error factories', () => {
    it('rateLimited and networkError and timeout default to retryable', () => {
      expect(CopilotError.rateLimited().retryable).toBe(true);
      expect(CopilotError.networkError('boom').retryable).toBe(true);
      expect(CopilotError.timeout().retryable).toBe(true);
    });

    it('authentication, modelNotFound, contextLimitExceeded, and model default to non-retryable', () => {
      expect(CopilotError.authentication().retryable).toBe(false);
      expect(CopilotError.modelNotFound('no such model').retryable).toBe(false);
      expect(CopilotError.contextLimitExceeded().retryable).toBe(false);
      expect(CopilotError.model('bad completion').retryable).toBe(false);
    });

    it('provider errors default to non-retryable but accept an explicit override', () => {
      expect(CopilotError.provider('5xx from provider').retryable).toBe(false);
      expect(CopilotError.provider('5xx from provider', undefined, true).retryable).toBe(true);
    });

    it('assigns the correct code to each new factory', () => {
      expect(CopilotError.model('x').code).toBe('MODEL_ERROR');
      expect(CopilotError.provider('x').code).toBe('PROVIDER_ERROR');
      expect(CopilotError.authentication().code).toBe('AUTHENTICATION_ERROR');
      expect(CopilotError.rateLimited().code).toBe('RATE_LIMITED');
      expect(CopilotError.modelNotFound('x').code).toBe('MODEL_NOT_FOUND');
      expect(CopilotError.contextLimitExceeded().code).toBe('CONTEXT_LIMIT_EXCEEDED');
      expect(CopilotError.timeout().code).toBe('TIMEOUT');
      expect(CopilotError.networkError('x').code).toBe('NETWORK_ERROR');
    });
  });
});
