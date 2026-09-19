/** Rate-policy foundation (Section 68-69) - deterministic, testable, in-process only. Not a
 * distributed limiter and not a billing platform (Section 68's explicit scope limit); an
 * application with multi-instance rate limiting needs would implement `RateLimiter` against
 * a shared store (e.g. Redis) itself. */
export interface RateLimitRule {
  readonly limit: number;
  readonly windowMs: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
}

export interface RateLimiter {
  consume(key: string, cost?: number, now?: number): RateLimitDecision;
}

/** Fixed-window counter per key (Section 69's example: `applications.delete: 5/hour`). Simple
 * by design - a sliding-window/token-bucket limiter can implement the same interface if an
 * application needs smoother throttling. */
export function createFixedWindowRateLimiter(
  rules: Readonly<Record<string, RateLimitRule>>,
  defaultRule?: RateLimitRule,
): RateLimiter {
  const windows = new Map<string, { readonly windowStart: number; count: number }>();

  return {
    consume(key, cost = 1, now = Date.now()) {
      const rule = rules[key] ?? defaultRule;
      if (!rule) return { allowed: true, remaining: Infinity };

      const existing = windows.get(key);
      const windowStart =
        existing && now - existing.windowStart < rule.windowMs ? existing.windowStart : now;
      const count = windowStart === existing?.windowStart ? existing.count : 0;

      if (count + cost > rule.limit) {
        windows.set(key, { windowStart, count });
        return { allowed: false, remaining: Math.max(rule.limit - count, 0) };
      }
      windows.set(key, { windowStart, count: count + cost });
      return { allowed: true, remaining: Math.max(rule.limit - (count + cost), 0) };
    },
  };
}
