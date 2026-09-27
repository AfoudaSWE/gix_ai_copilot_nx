import { execSync } from 'node:child_process';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryRateLimiter, createRedisLock, createRedisRateLimiter, redisHealth } from './index.js';

function dockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('memory rate limiter', () => {
  it('enforces a window and does not charge rejected requests', async () => {
    let now = 0;
    const limiter = createMemoryRateLimiter(() => now);
    const rule = { limit: 3, windowMs: 1000 };
    const results = [];
    for (let index = 0; index < 5; index += 1) results.push((await limiter.consume('tenant-a', rule)).allowed);
    expect(results).toEqual([true, true, true, false, false]);
    now = 1000;
    expect((await limiter.consume('tenant-a', rule)).allowed).toBe(true);
  });
});

describe.skipIf(!dockerAvailable())('Redis rate limiting and locks (real Redis, several instances)', () => {
  let container: StartedRedisContainer;
  const clients: Redis[] = [];
  const client = (): Redis => {
    const instance = new Redis({ host: container.getHost(), port: container.getPort(), maxRetriesPerRequest: 1 });
    clients.push(instance);
    return instance;
  };
  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
  }, 120_000);
  afterAll(async () => {
    await Promise.all(clients.map((instance) => instance.quit()));
    await container?.stop();
  });

  it('three server instances share one limit per key (Section 186)', async () => {
    const instances = [createRedisRateLimiter(client()), createRedisRateLimiter(client()), createRedisRateLimiter(client())];
    const rule = { limit: 10, windowMs: 60_000 };
    const pick = (index: number) => {
      const instance = instances[index % 3];
      if (!instance) throw new Error('missing limiter');
      return instance;
    };
    const decisions = await Promise.all(Array.from({ length: 30 }, (_, index) => pick(index).consume('tenant-a:requests', rule)));
    expect(decisions.filter((decision) => decision?.allowed)).toHaveLength(10);
    // Another tenant has its own budget.
    expect((await instances[0]?.consume('tenant-b:requests', rule))?.allowed).toBe(true);
    const rejected = decisions.find((decision) => decision && !decision.allowed);
    expect(rejected?.remaining).toBe(0);
    expect(rejected?.resetMs).toBeGreaterThan(0);
    // Weighted cost (e.g. tokens) and rejected requests don't consume.
    expect((await instances[1]?.consume('tenant-c:tokens', { limit: 100, windowMs: 60_000 }, 80))?.allowed).toBe(true);
    expect((await instances[2]?.consume('tenant-c:tokens', { limit: 100, windowMs: 60_000 }, 30))?.allowed).toBe(false);
    expect((await instances[2]?.consume('tenant-c:tokens', { limit: 100, windowMs: 60_000 }, 20))?.allowed).toBe(true);
    await expect(instances[0]?.consume('bad key with spaces', rule)).rejects.toThrow();
  });

  it('locks are exclusive and only the holder can release', async () => {
    const lockA = createRedisLock(client());
    const lockB = createRedisLock(client());
    const held = await lockA.tryAcquire('maintenance', 5000);
    expect(held).toBeDefined();
    expect(await lockB.tryAcquire('maintenance', 5000)).toBeUndefined();
    expect(await held?.release()).toBe(true);
    const next = await lockB.tryAcquire('maintenance', 50);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const stolen = await lockA.tryAcquire('maintenance', 5000);
    expect(stolen).toBeDefined();
    expect(await next?.release()).toBe(false);
    expect(await redisHealth(client())).toMatchObject({ ok: true });
  });
});
