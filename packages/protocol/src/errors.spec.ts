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
});
