import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

export interface LockHandle {
  readonly key: string;
  /** Releases only if this holder still owns the lock (never another holder's lock). */
  release(): Promise<boolean>;
}

export interface DistributedLock {
  /** Returns a handle, or `undefined` when another holder has the lock. */
  tryAcquire(key: string, ttlMs: number): Promise<LockHandle | undefined>;
}

const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

/**
 * A single-Redis lease lock for temporary coordination (e.g. one maintenance job at a time).
 * It is a lease, not a correctness guarantee across Redis failover: work guarded by it must
 * still be idempotent. Durable state stays in PostgreSQL.
 */
export function createRedisLock(client: Redis, options: { readonly prefix?: string } = {}): DistributedLock {
  const prefix = options.prefix ?? 'aicopilot:lock';
  return {
    async tryAcquire(key, ttlMs) {
      const token = randomUUID();
      const full = `${prefix}:${key}`;
      const ok = await client.set(full, token, 'PX', ttlMs, 'NX');
      if (ok !== 'OK') return undefined;
      return {
        key,
        release: async () => (await client.eval(RELEASE, 1, full, token)) === 1,
      };
    },
  };
}

/** Readiness check: PING with a timeout. Never throws. */
export async function redisHealth(client: Redis, timeoutMs = 1000): Promise<{ readonly ok: boolean; readonly latencyMs: number; readonly error?: string }> {
  const started = performance.now();
  try {
    await Promise.race([client.ping(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs).unref())]);
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    return { ok: false, latencyMs: Math.round(performance.now() - started), error: error instanceof Error && error.message === 'timeout' ? 'redis timeout' : 'redis unreachable' };
  }
}
