import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { recordScenario } from '../fixtures.spec-helper.js';
import { createDevTools } from '../recorder.js';
import { createDevToolsPlugin } from './plugin.js';

const TOKEN = 'devtools-test-token';

async function app(options: Parameters<typeof createDevToolsPlugin>[1]): Promise<FastifyInstance> {
  const instance = Fastify();
  await instance.register(createDevToolsPlugin(createDevTools({ source: await recordScenario() }), options));
  await instance.ready();
  return instance;
}

describe('DevTools transport security (Section 25, 163-164, 180)', () => {
  let instance: FastifyInstance | undefined;
  afterEach(async () => {
    await instance?.close();
    instance = undefined;
  });

  it('disabled (the default for production config) exposes no endpoint at all', async () => {
    instance = await app({ enabled: false });
    for (const url of ['/devtools/session', '/devtools/export', '/devtools/stream']) {
      expect((await instance.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
  });

  it('refuses to register without an authorizer unless explicitly unauthenticated', async () => {
    await expect(app({ enabled: true })).rejects.toThrow('requires authorize');
  });

  it('refuses to register in production unless deliberately allowed', async () => {
    const previous = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      await expect(app({ enabled: true, authorize: () => true })).rejects.toThrow('disabled in production');
    } finally {
      process.env['NODE_ENV'] = previous;
    }
  });

  it('rejects unauthenticated requests and scopes authenticated ones to the viewer', async () => {
    instance = await app({
      enabled: true,
      authorize: (request) => request.headers.authorization === `Bearer ${TOKEN}`,
      resolveViewer: () => ({ tenantId: 'tenant-a' }),
    });
    expect((await instance.inject({ method: 'GET', url: '/devtools/session' })).statusCode).toBe(401);
    const session = await instance.inject({ method: 'GET', url: '/devtools/session', headers: { authorization: `Bearer ${TOKEN}` } });
    expect(session.statusCode).toBe(200);
    expect(session.body).toContain('run-a');
    expect(session.body).not.toContain('run-b');
    const other = await instance.inject({ method: 'GET', url: '/devtools/runs/run-b', headers: { authorization: `Bearer ${TOKEN}` } });
    expect(other.statusCode).toBe(404);
  });

  it('is read-only: there is no route that executes, approves or mutates anything', async () => {
    instance = await app({ enabled: true, allowUnauthenticated: true });
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      for (const url of ['/devtools/session', '/devtools/tools/applications.delete/execute', '/devtools/approvals/approval-1', '/devtools/runs/run-a']) {
        expect((await instance.inject({ method, url })).statusCode).toBe(404);
      }
    }
  });
});
