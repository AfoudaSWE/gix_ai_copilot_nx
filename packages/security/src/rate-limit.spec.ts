import { describe, expect, it } from 'vitest';
import { createFixedWindowRateLimiter } from './rate-limit.js';

describe('createFixedWindowRateLimiter', () => {
  it('allows up to the configured limit within a window, then denies', () => {
    const limiter = createFixedWindowRateLimiter({ 'applications.delete': { limit: 2, windowMs: 1000 } });
    const now = 1_000_000;
    expect(limiter.consume('applications.delete', 1, now).allowed).toBe(true);
    expect(limiter.consume('applications.delete', 1, now + 10).allowed).toBe(true);
    expect(limiter.consume('applications.delete', 1, now + 20).allowed).toBe(false);
  });

  it('resets the count once the window elapses', () => {
    const limiter = createFixedWindowRateLimiter({ x: { limit: 1, windowMs: 100 } });
    const now = 1_000_000;
    expect(limiter.consume('x', 1, now).allowed).toBe(true);
    expect(limiter.consume('x', 1, now + 50).allowed).toBe(false);
    expect(limiter.consume('x', 1, now + 150).allowed).toBe(true);
  });

  it('a key with no configured rule and no default is unlimited', () => {
    const limiter = createFixedWindowRateLimiter({});
    expect(limiter.consume('anything', 1000).allowed).toBe(true);
  });

  it('applies a default rule to keys without their own', () => {
    const limiter = createFixedWindowRateLimiter({}, { limit: 1, windowMs: 1000 });
    const now = 1_000_000;
    expect(limiter.consume('any-key', 1, now).allowed).toBe(true);
    expect(limiter.consume('any-key', 1, now + 1).allowed).toBe(false);
  });
});
