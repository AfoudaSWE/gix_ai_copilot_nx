import { afterEach, describe, expect, it } from 'vitest';
import { createEchoExecutor, createRuntime } from '@gixcopilot/core';
import { createServer } from './app.js';
import { createMetricsRegistry, createRunMetricsObserver, registerOperationalRoutes } from './operations.js';

const apps: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('operational routes', () => {
  it('separates liveness from readiness and reports dependency failures without details', async () => {
    let databaseUp = true;
    let shuttingDown = false;
    const app = createServer({ runtime: createRuntime({ executor: createEchoExecutor() }) });
    apps.push(app);
    registerOperationalRoutes(app, {
      readiness: [
        { name: 'database', check: () => Promise.resolve(databaseUp ? { ok: true } : { ok: false, error: 'database unreachable' }) },
        { name: 'redis', check: () => new Promise(() => undefined) },
        { name: 'telemetry-exporter', critical: false, check: () => Promise.reject(new Error('password=hunter2 leaked?')) },
      ],
      checkTimeoutMs: 50,
      isShuttingDown: () => shuttingDown,
    });
    expect((await app.inject({ url: '/health' })).json()).toEqual({ status: 'ok' });
    const notReady = await app.inject({ url: '/ready' });
    expect(notReady.statusCode).toBe(503);
    expect(notReady.json<{ checks: { name: string; ok: boolean; error?: string }[] }>().checks.map((check) => [check.name, check.ok, check.error])).toEqual([
      ['database', true, undefined],
      ['redis', false, 'timeout'],
      ['telemetry-exporter', false, 'check failed'],
    ]);
    expect(notReady.body).not.toContain('hunter2');
    databaseUp = false;
    expect((await app.inject({ url: '/ready' })).body).toContain('database unreachable');
    shuttingDown = true;
    expect((await app.inject({ url: '/ready' })).json()).toMatchObject({ status: 'shutting-down' });
    // Liveness stays up while dependencies are down.
    expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
  });

  it('serves protected, low-cardinality Prometheus metrics fed by a run observer', async () => {
    const registry = createMetricsRegistry();
    const app = createServer({ runtime: createRuntime({ executor: createEchoExecutor() }), runObservers: [createRunMetricsObserver(registry)] });
    apps.push(app);
    registerOperationalRoutes(app, { metrics: { registry, bearerToken: 'metrics-token' } });
    const run = await app.inject({ method: 'POST', url: '/runs', payload: { messages: [{ role: 'user', content: [{ type: 'text', text: 'tenant secret prompt' }] }] } });
    expect(run.statusCode).toBe(200);
    expect((await app.inject({ url: '/metrics' })).statusCode).toBe(401);
    const metrics = await app.inject({ url: '/metrics', headers: { authorization: 'Bearer metrics-token' } });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain('copilot_runs_total{status="completed"} 1');
    expect(metrics.body).toContain('# TYPE copilot_runs_total counter');
    expect(metrics.body).toContain('copilot_active_runs 0');
    expect(metrics.body).not.toContain('tenant secret prompt');
  });

  it('does not serve /metrics unless configured', async () => {
    const app = createServer({ runtime: createRuntime({ executor: createEchoExecutor() }) });
    apps.push(app);
    registerOperationalRoutes(app, {});
    expect((await app.inject({ url: '/metrics' })).statusCode).toBe(404);
  });
});
