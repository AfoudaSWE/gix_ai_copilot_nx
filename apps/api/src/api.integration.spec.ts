import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '@gixcopilot/config';
import { createPostgresPersistence } from '@gixcopilot/persistence-postgres';
import { signJwt } from './auth.js';
import { createApiServer } from './bootstrap.js';
import type { ApiServer } from './bootstrap.js';

function dockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const jwtSecret = randomBytes(32).toString('hex');
const token = (sub: string, tenant: string, permissions: string[] = []): string =>
  signJwt({ sub, tenant_id: tenant, permissions, exp: Math.floor(Date.now() / 1000) + 600, iss: 'aicopilot', aud: 'api' }, jwtSecret);

describe.skipIf(!dockerAvailable())('apps/api on real PostgreSQL + Redis', () => {
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let server: ApiServer;

  beforeAll(async () => {
    [postgres, redis] = await Promise.all([new PostgreSqlContainer('pgvector/pgvector:pg16').start(), new RedisContainer('redis:7-alpine').start()]);
    const config = await loadConfig({
      env: {
        NODE_ENV: 'test',
        DATABASE_URL: postgres.getConnectionUri(),
        REDIS_URL: `redis://${redis.getHost()}:${redis.getPort()}`,
        AICOPILOT_REQUIRE_AUTH: 'true',
        AICOPILOT_JWT_SECRET: jwtSecret,
        AICOPILOT_JWT_ISSUER: 'aicopilot',
        AICOPILOT_JWT_AUDIENCE: 'api',
        AICOPILOT_MANAGEMENT_ENABLED: 'true',
        AICOPILOT_SECRET_KEY: randomBytes(32).toString('base64'),
        AICOPILOT_METRICS_ENABLED: 'true',
        AICOPILOT_METRICS_TOKEN: 'metrics-token-for-tests',
        AICOPILOT_MODEL_PROVIDER: 'mock',
        AICOPILOT_MODEL: 'dev',
      },
    });
    server = await createApiServer({ config, pricing: { version: 'test', currency: 'USD', models: { 'mock/dev': { inputPerMillion: 1_000_000, outputPerMillion: 1_000_000 } } } });
  }, 180_000);

  afterAll(async () => {
    await server?.shutdown();
    await Promise.all([postgres?.stop(), redis?.stop()]);
  });

  it('is live but not ready until migrations are applied (they are never applied at startup)', async () => {
    expect((await server.app.inject({ url: '/health' })).statusCode).toBe(200);
    const notReady = await server.app.inject({ url: '/ready' });
    expect(notReady.statusCode).toBe(503);
    expect(notReady.body).toContain('pending migrations');
    const migrator = createPostgresPersistence({ connectionString: postgres.getConnectionUri() });
    try {
      await migrator.migrator.up();
    } finally {
      await migrator.close();
    }
    const ready = await server.app.inject({ url: '/ready' });
    expect(ready.json()).toMatchObject({ status: 'ready' });
  });

  it('serves authenticated chat, persists it per tenant, and applies control-plane budgets to the next run', async () => {
    const anonymous = await server.app.inject({ method: 'POST', url: '/runs', payload: { threadId: 't-1', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] } });
    expect(anonymous.statusCode).toBe(401);

    const root = { authorization: `Bearer ${token('root', 'platform', ['platform.admin'])}` };
    expect((await server.app.inject({ method: 'POST', url: '/management/v1/tenants', headers: root, payload: { id: 'acme', name: 'Acme', owner: 'alice' } })).statusCode).toBe(201);
    const alice = { authorization: `Bearer ${token('alice', 'acme')}` };
    const run = await server.app.inject({ method: 'POST', url: '/runs', headers: alice, payload: { threadId: 'thread-1', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] } });
    expect(run.statusCode).toBe(200);
    expect(run.body).toContain('development mock provider');

    const conversations = await server.app.inject({ url: '/management/v1/conversations', headers: alice });
    expect(conversations.json<{ items: { id: string }[] }>().items.map((thread) => thread.id)).toEqual(['thread-1']);
    const usage = await server.app.inject({ url: '/management/v1/usage?groupBy=kind', headers: alice });
    expect(usage.json<{ rows: { key: { kind: string } }[] }>().rows.map((row) => row.key.kind).sort()).toEqual(['model', 'request']);

    // A budget configured in the platform blocks the NEXT run (usage above already exceeds 1 micro).
    const budget = await server.app.inject({ method: 'POST', url: '/management/v1/resources', headers: alice, payload: { kind: 'budget', name: 'tiny', spec: { scope: 'tenant', limitMicros: 1, period: 'month', action: 'block' } } });
    expect(budget.statusCode).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 16_000)); // snapshot cache TTL (15s)
    const blocked = await server.app.inject({ method: 'POST', url: '/runs', headers: alice, payload: { messages: [{ role: 'user', content: [{ type: 'text', text: 'again' }] }] } });
    expect(blocked.statusCode).toBe(402);
    expect(blocked.json()).toMatchObject({ error: { code: 'BUDGET_EXCEEDED' } });

    // Another tenant is unaffected and cannot see Acme's data.
    await server.app.inject({ method: 'POST', url: '/management/v1/tenants', headers: root, payload: { id: 'globex', name: 'Globex', owner: 'gary' } });
    const gary = { authorization: `Bearer ${token('gary', 'globex')}` };
    expect((await server.app.inject({ method: 'POST', url: '/runs', headers: gary, payload: { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] } })).statusCode).toBe(200);
    const otherConversations = (await server.app.inject({ url: '/management/v1/conversations', headers: gary })).json<{ items: { id: string }[] }>().items;
    expect(otherConversations).toHaveLength(1);
    expect(otherConversations.map((thread) => thread.id)).not.toContain('thread-1');
  }, 60_000);

  it('protects /metrics and logs no credentials', async () => {
    expect((await server.app.inject({ url: '/metrics' })).statusCode).toBe(401);
    const metrics = await server.app.inject({ url: '/metrics', headers: { authorization: 'Bearer metrics-token-for-tests' } });
    expect(metrics.body).toContain('copilot_runs_total');
    expect(metrics.body).not.toMatch(/acme|alice|globex/);
  });
});
