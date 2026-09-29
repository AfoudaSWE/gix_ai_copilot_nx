import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { ModelProvider } from '@gixcopilot/provider';
import { afterEach, describe, expect, it } from 'vitest';
import { createFixture, NX_FIXTURE, removeFixture, snapshot } from '../fixtures.spec-helper.js';
import { createStudioService } from '../service.js';
import type { StudioServiceOptions } from '../service.js';
import { registerStudio, STUDIO_TOKEN_HEADER, studioPlugin } from './index.js';

const KEY = 'sk-proj-studio-test-key-0123456789abcdefghij';
const apps: FastifyInstance[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) removeFixture(root);
});

const okProvider = (seen: { apiKey?: string }): ((settings: { apiKey?: string }) => ModelProvider) => (settings) => {
  seen.apiKey = settings.apiKey;
  return {
    id: 'openai',
    async *stream() {
      await Promise.resolve();
      yield { type: 'model.started' };
      yield { type: 'content.delta', delta: 'OK' };
      yield { type: 'model.completed', finishReason: 'stop' };
    },
  };
};

async function setup(environment = 'development', extra: Partial<StudioServiceOptions> = {}): Promise<{ app: FastifyInstance; root: string; token: string }> {
  const root = createFixture(NX_FIXTURE);
  roots.push(root);
  const app = Fastify();
  apps.push(app);
  await app.register(studioPlugin, { environment, service: createStudioService({ root, ...extra }) });
  await app.ready();
  if (environment === 'production') return { app, root, token: '' };
  const page = await app.inject({ method: 'GET', url: '/__gix', headers: { host: 'localhost:3000' } });
  const token = /name="gix-studio-token" content="([^"]+)"/.exec(page.body)?.[1] ?? '';
  return { app, root, token };
}

const headers = (token: string, extra: Record<string, string> = {}) => ({ host: 'localhost:3000', origin: 'http://localhost:3000', [STUDIO_TOKEN_HEADER]: token, ...extra });

describe('production isolation (§6, §76)', () => {
  it('registers nothing in production: /__gix and /__gix/api/* are 404', async () => {
    const { app } = await setup('production');
    for (const url of ['/__gix', '/__gix/api/status', '/__gix/api/diagnostics', '/__gix/api/proposals']) {
      expect((await app.inject({ method: 'GET', url, headers: { host: 'localhost' } })).statusCode, url).toBe(404);
    }
    expect((await app.inject({ method: 'POST', url: '/__gix/api/discovery/project', headers: { host: 'localhost' }, payload: {} })).statusCode).toBe(404);
  });

  it('registerStudio creates no service in production', async () => {
    const root = createFixture({ 'package.json': '{}' });
    roots.push(root);
    const app = Fastify();
    apps.push(app);
    expect(await registerStudio(app, { root, environment: 'production' })).toBeUndefined();
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/__gix' })).statusCode).toBe(404);
  });
});

describe('development API protection (§68)', () => {
  it('serves the Studio page with a strict CSP and an embedded token', async () => {
    const root = createFixture({ 'package.json': '{}' });
    roots.push(root);
    const app = Fastify();
    apps.push(app);
    await registerStudio(app, { root, environment: 'development' });
    const page = await app.inject({ method: 'GET', url: '/__gix', headers: { host: '127.0.0.1:4000' } });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-security-policy']).toMatch(/script-src 'nonce-[^']+'; .*frame-ancestors 'none'/);
    expect(page.body).toContain('Developer Studio');
    expect(page.body).toMatch(/name="gix-studio-token" content="[\w-]{40,}"/);
  });

  it('rejects requests without the Studio token, from other hosts, or from other origins', async () => {
    const { app, token } = await setup();
    expect((await app.inject({ method: 'GET', url: '/__gix/api/status', headers: { host: 'localhost:3000' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/__gix/api/status', headers: headers('wrong-token') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/__gix/api/status', headers: headers(token, { host: 'attacker.example:3000' }) })).json()).toMatchObject({ error: { code: 'HOST_NOT_ALLOWED' } });
    expect((await app.inject({ method: 'GET', url: '/__gix/api/status', headers: headers(token, { origin: 'http://evil.example' }) })).json()).toMatchObject({ error: { code: 'ORIGIN_NOT_ALLOWED' } });
    expect((await app.inject({ method: 'GET', url: '/__gix/api/status', headers: headers(token, { 'sec-fetch-site': 'cross-site' }) })).statusCode).toBe(403);
    const { origin: _origin, ...noOrigin } = headers(token);
    expect((await app.inject({ method: 'POST', url: '/__gix/api/discovery/project', headers: noOrigin, payload: {} })).json()).toMatchObject({ error: { code: 'ORIGIN_REQUIRED' } });
    const ok = await app.inject({ method: 'GET', url: '/__gix/api/status', headers: headers(token) });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
  });

  it('runs the full discover → generate → approve → apply flow over HTTP', async () => {
    const { app, token, root } = await setup('development', { commandRunner: () => Promise.resolve({ exitCode: 0, output: '' }) });
    const before = snapshot(root);
    const discovered = await app.inject({ method: 'POST', url: '/__gix/api/discovery/apis', headers: headers(token), payload: {} });
    expect(discovered.json<{ apis: unknown[] }>().apis.length).toBeGreaterThan(0);
    const proposal = (await app.inject({ method: 'POST', url: '/__gix/api/generators/components-ui', headers: headers(token), payload: {} })).json<{ id: string; status: string }>();
    expect(proposal.status).toBe('ready-for-review');
    expect(snapshot(root)).toEqual(before);
    const view = (await app.inject({ method: 'GET', url: `/__gix/api/proposals/${proposal.id}`, headers: headers(token) })).json<{ diffs: { diff: string }[] }>();
    expect(view.diffs[0]?.diff).toContain('+++ b/.gix/ui/generative-components.ts');
    expect((await app.inject({ method: 'POST', url: `/__gix/api/proposals/${proposal.id}/apply`, headers: headers(token), payload: {} })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/__gix/api/proposals/${proposal.id}/approve`, headers: headers(token), payload: {} })).json()).toMatchObject({ status: 'approved' });
    const applied = (await app.inject({ method: 'POST', url: `/__gix/api/proposals/${proposal.id}/apply`, headers: headers(token), payload: {} })).json<{ status: string; applyResult: { message: string } }>();
    expect(applied).toMatchObject({ status: 'applied', applyResult: { message: 'APPLY COMPLETE' } });
    expect(Object.keys(snapshot(root))).toContain('.gix/ui/generative-components.ts');
  });

  it('validates input and maps errors to status codes', async () => {
    const { app, token } = await setup();
    expect((await app.inject({ method: 'POST', url: '/__gix/api/generators/nope', headers: headers(token), payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/__gix/api/discovery/everything', headers: headers(token), payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/__gix/api/config/copilot', headers: headers(token), payload: { values: { 'appearance.colors.primary': 'red', 'shell.command': 'rm -rf /' } } })).statusCode).toBe(400);
    const proposal = (await app.inject({ method: 'POST', url: '/__gix/api/config/copilot', headers: headers(token), payload: { values: { 'appearance.colors.primary': '#e11d2e', 'copilot.suggestions': ['Show my applications'] } } })).json<{ configChanges: unknown[]; fileChanges: { path: string }[] }>();
    expect(proposal.configChanges).toHaveLength(2);
    expect(proposal.fileChanges.map((change) => change.path)).toEqual(['.gix/copilot.config.json']);
  });
});

describe('model configuration (§8-9)', () => {
  it('never returns the API key, and uses it only through the provider adapter', async () => {
    const seen: { apiKey?: string } = {};
    const { app, token } = await setup('development', { providers: { openai: okProvider(seen) } });
    const saved = await app.inject({ method: 'PUT', url: '/__gix/api/config/model', headers: headers(token), payload: { provider: 'openai', model: 'gpt-4o-mini', apiKey: KEY } });
    expect(saved.json()).toEqual({ provider: 'openai', model: 'gpt-4o-mini', configured: true, keySource: 'studio-session', providers: ['openai'] });
    expect(saved.body).not.toContain(KEY);
    const read = await app.inject({ method: 'GET', url: '/__gix/api/config/model', headers: headers(token) });
    expect(read.body).not.toContain(KEY);
    expect(read.body).not.toContain('apiKey');
    const test = (await app.inject({ method: 'POST', url: '/__gix/api/config/model/test', headers: headers(token), payload: {} })).json<Record<string, unknown>>();
    expect(test).toMatchObject({ success: true, provider: 'openai', model: 'gpt-4o-mini' });
    expect(Object.keys(test).sort()).toEqual(['latencyMs', 'model', 'provider', 'success']);
    expect(seen.apiKey).toBe(KEY);
    const diagnostics = (await app.inject({ method: 'GET', url: '/__gix/api/diagnostics', headers: headers(token) })).json<{ runtime: { key: string; status: string }[] }>();
    expect(diagnostics.runtime.find((row) => row.key === 'provider')?.status).toBe('ok');
  });

  it('returns a normalized, redacted error when the connection fails', async () => {
    const failing = (): ModelProvider => ({
      id: 'openai',
      // A provider that fails before its first event, echoing the key as some SDKs do.
      stream: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error(`401 Incorrect API key provided: ${KEY}`)) }) }),
    });
    const { app, token } = await setup('development', { providers: { openai: failing } });
    await app.inject({ method: 'PUT', url: '/__gix/api/config/model', headers: headers(token), payload: { provider: 'openai', model: 'gpt-4o-mini', apiKey: KEY } });
    const result = await app.inject({ method: 'POST', url: '/__gix/api/config/model/test', headers: headers(token), payload: {} });
    expect(result.json()).toMatchObject({ success: false, provider: 'openai', error: { retryable: expect.any(Boolean) as boolean } });
    expect(result.body).not.toContain(KEY);
  });
});

describe('configuration view (§11, §63)', () => {
  it('redacts secrets in resolved configuration and lists tool policies', async () => {
    const { app, token } = await setup('development', {
      configLayers: () => ({ environment: { models: { providers: { openai: { apiKey: 'sk-live-fake-value-should-not-show', baseUrl: 'https://api.openai.com' } } }, database: { url: 'postgres://user:pw@db:5432/app' }, jwt: { secret: { secret: 'JWT_SECRET' } } } }),
      tools: () => [{ name: 'applications.delete', security: { risk: 'destructive', approval: 'admin', requiredPermissions: ['APPLICATION_DELETE'] } }],
      security: () => ({ firewall: true, approvalPolicy: 'default risk policy', audit: true }),
    });
    const body = (await app.inject({ method: 'GET', url: '/__gix/api/config', headers: headers(token) })).body;
    expect(body).not.toContain('sk-live-fake-value');
    expect(body).not.toContain('user:pw');
    expect(body).toContain('JWT_SECRET');
    expect(body).toContain('https://api.openai.com');
    expect(JSON.parse(body)).toMatchObject({ security: { firewall: true, audit: true, toolPolicies: [{ name: 'applications.delete' }] } });
  });

  it('lists development capabilities as development-plane only', async () => {
    const { app, token } = await setup();
    const caps = (await app.inject({ method: 'GET', url: '/__gix/api/capabilities', headers: headers(token) })).json<{ capabilities: { plane: string }[] }>();
    expect(caps.capabilities.length).toBeGreaterThan(30);
    expect(caps.capabilities.every((capability) => capability.plane === 'development')).toBe(true);
  });
});

describe('live preview (§7)', () => {
  const previewDirectory = fileURLToPath(new URL('../../../studio-preview/web-dist/', import.meta.url));

  async function previewApp(options: { previewDirectory?: string; copilotRuntimeUrl?: string } = {}): Promise<{ app: FastifyInstance; token: string }> {
    const root = createFixture({ 'package.json': '{}' });
    roots.push(root);
    const app = Fastify();
    apps.push(app);
    await app.register(studioPlugin, { environment: 'development', service: createStudioService({ root }), ...options });
    await app.ready();
    const page = await app.inject({ method: 'GET', url: '/__gix', headers: { host: 'localhost:3000' } });
    return { app, token: /name="gix-studio-token" content="([^"]+)"/.exec(page.body)?.[1] ?? '' };
  }

  it('serves the real @gixcopilot/ui bundle, framable by the Studio only', async () => {
    const { app } = await previewApp({ previewDirectory, copilotRuntimeUrl: '/' });
    const page = await app.inject({ method: 'GET', url: '/__gix', headers: { host: 'localhost:3000' } });
    expect(page.headers['content-security-policy']).toContain("frame-src 'self'");
    expect(page.body).toContain('data-runtime="/"');
    const index = await app.inject({ method: 'GET', url: '/__gix/preview/', headers: { host: 'localhost:3000' } });
    expect(index.statusCode).toBe(200);
    expect(index.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(index.headers['content-security-policy']).toMatch(/script-src 'self'.*frame-ancestors 'self'/);
    const script = /src="\.\/assets\/([^"]+\.js)"/.exec(index.body)?.[1] ?? '';
    const asset = await app.inject({ method: 'GET', url: `/__gix/preview/assets/${script}`, headers: { host: 'localhost:3000' } });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toContain('text/javascript');
    expect(asset.body).toContain('gix-preview-settings');
  });

  it('serves only files that exist in the bundle, by exact name', async () => {
    const { app } = await previewApp({ previewDirectory });
    for (const file of ['missing.js', '..%2F..%2Fpackage.json', '..%5Cindex.html', 'index.html']) {
      expect((await app.inject({ method: 'GET', url: `/__gix/preview/assets/${file}`, headers: { host: 'localhost:3000' } })).statusCode, file).toBe(404);
    }
    expect((await app.inject({ method: 'GET', url: '/__gix/preview/', headers: { host: 'evil.example' } })).statusCode).toBe(403);
  });

  it('reports a missing bundle instead of serving nothing, and rejects a cross-origin runtime', async () => {
    const { app } = await previewApp({ previewDirectory: fileURLToPath(new URL('./no-such-dir/', import.meta.url)) });
    expect((await app.inject({ method: 'GET', url: '/__gix/preview/', headers: { host: 'localhost:3000' } })).json()).toMatchObject({ error: { code: 'PREVIEW_NOT_BUILT' } });
    await expect(previewApp({ copilotRuntimeUrl: 'https://evil.example' })).rejects.toThrow(/same-origin path/);
    await expect(previewApp({ copilotRuntimeUrl: '//evil.example' })).rejects.toThrow(/same-origin path/);
  });
});

describe('Studio page script', () => {
  it('is syntactically valid JavaScript (it has no build step to catch mistakes)', async () => {
    const { renderStudioPage } = await import('./page.js');
    const html = renderStudioPage({ token: 't', nonce: 'n', basePath: '/__gix', systemInstructionsNotice: 'x', copilotRuntimeUrl: '/' });
    const script = html.slice(html.indexOf('<script nonce="n">') + '<script nonce="n">'.length, html.lastIndexOf('</script>'));
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- parsed only, never called
    expect(() => new Function(script)).not.toThrow();
  });
});
