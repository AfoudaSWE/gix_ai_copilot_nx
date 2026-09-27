import type { Redis } from 'ioredis';

export interface DistributedRateLimitRule {
  readonly limit: number;
  readonly windowMs: number;
}

export interface DistributedRateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  /** Milliseconds until the current window resets. */
  readonly resetMs: number;
  readonly limit: number;
}

/** Async rate limiter shared by every server instance (Section 76). */
export interface DistributedRateLimiter {
  consume(key: string, rule: DistributedRateLimitRule, cost?: number): Promise<DistributedRateLimitDecision>;
}

/*
 * Fixed-window counter, evaluated atomically in Redis. The window bucket uses the Redis
 * server's clock (TIME), so instances with skewed clocks still share one window. A rejected
 * request does not consume capacity.
 */
const SCRIPT = `
local now = redis.call('TIME')
local nowMs = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local windowMs = tonumber(ARGV[2])
local bucket = math.floor(nowMs / windowMs)
local key = KEYS[1] .. ':' .. bucket
local cost = tonumber(ARGV[1])
local limit = tonumber(ARGV[3])
local current = tonumber(redis.call('GET', key) or '0')
local resetMs = (bucket + 1) * windowMs - nowMs
if current + cost > limit then
  return {0, current, resetMs}
end
current = redis.call('INCRBY', key, cost)
if current == cost then
  redis.call('PEXPIRE', key, windowMs + 1000)
end
return {1, current, resetMs}
`;

const KEY = /^[A-Za-z0-9._:|@-]{1,256}$/;

export function createRedisRateLimiter(client: Redis, options: { readonly prefix?: string } = {}): DistributedRateLimiter {
  const prefix = options.prefix ?? 'aicopilot:rl';
  return {
    async consume(key, rule, cost = 1) {
      if (!KEY.test(key)) throw new Error('Invalid rate-limit key.');
      if (!Number.isInteger(rule.limit) || rule.limit < 0 || !Number.isInteger(rule.windowMs) || rule.windowMs < 1) throw new Error('Invalid rate-limit rule.');
      const [allowed, count, resetMs] = (await client.eval(SCRIPT, 1, `${prefix}:${key}`, String(cost), String(rule.windowMs), String(rule.limit))) as [number, number, number];
      return { allowed: allowed === 1, remaining: Math.max(rule.limit - count, 0), resetMs, limit: rule.limit };
    },
  };
}

/** In-process equivalent for development/tests and single-instance deployments. */
export function createMemoryRateLimiter(now: () => number = Date.now): DistributedRateLimiter {
  const windows = new Map<string, { bucket: number; count: number }>();
  return {
    consume(key, rule, cost = 1) {
      const time = now();
      const bucket = Math.floor(time / rule.windowMs);
      const entry = windows.get(key);
      const count = entry?.bucket === bucket ? entry.count : 0;
      const resetMs = (bucket + 1) * rule.windowMs - time;
      if (count + cost > rule.limit) return Promise.resolve({ allowed: false, remaining: Math.max(rule.limit - count, 0), resetMs, limit: rule.limit });
      windows.set(key, { bucket, count: count + cost });
      return Promise.resolve({ allowed: true, remaining: Math.max(rule.limit - count - cost, 0), resetMs, limit: rule.limit });
    },
  };
}
