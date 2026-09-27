import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createToolRegistry, staticCredentialProvider } from '@gixcopilot/tools';
import type { AnyToolDefinition, ToolExecutionContext } from '@gixcopilot/tools';
import { defineHttpApi, httpApiFromManifest, loadHttpApiManifest } from './index.js';

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

/** A plain Node HTTP API: stands in for "any language or framework". */
let server: Server;
let baseUrl = '';
const seen: Seen[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      const url = new URL(req.url ?? '/', 'http://x');
      const send = (status: number, value: unknown, type = 'application/json'): void => {
        res.writeHead(status, { 'content-type': type, 'x-internal-trace': 'secret-trace' });
        res.end(type.includes('json') ? JSON.stringify(value) : String(value));
      };
      if (url.pathname.startsWith('/customers/') && req.method === 'GET') return send(200, { id: decodeURIComponent(url.pathname.split('/')[2] ?? ''), name: 'Omar', token: req.headers.authorization });
      if (url.pathname === '/customers' && req.method === 'GET') return send(200, { q: url.searchParams.get('q'), tags: url.searchParams.getAll('tag') });
      if (url.pathname === '/orders' && req.method === 'POST') return send(201, { created: JSON.parse(body) as unknown });
      if (url.pathname === '/legacy/login' && req.method === 'POST') return send(200, { form: body, type: req.headers['content-type'] });
      if (url.pathname === '/broken') return send(200, { unexpected: true });
      if (url.pathname === '/missing') return send(404, { error: 'not found' });
      if (url.pathname === '/graphql') {
        const payload = JSON.parse(body) as { query: string; variables: Record<string, unknown> };
        if (payload.query.includes('failing')) return send(200, { errors: [{ message: 'Field "failing" not found' }] });
        return send(200, { data: { order: { id: payload.variables['id'], status: 'shipped' } } });
      }
      send(404, { error: 'no route' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const context = (): ToolExecutionContext => ({ runId: 'run-1', signal: new AbortController().signal });

function tool(tools: readonly AnyToolDefinition[], name: string): AnyToolDefinition {
  const found = tools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

async function run(definition: AnyToolDefinition, input: unknown): Promise<unknown> {
  return definition.execute(definition.inputSchema.parse(input), context());
}

function crm() {
  return defineHttpApi({
    id: 'crm',
    baseUrl,
    credentials: staticCredentialProvider({ kind: 'bearer', token: 'tok-123' }),
    endpoints: {
      'customers.get': { method: 'get', path: '/customers/{id}', description: 'Get one customer', input: z.object({ id: z.string() }) },
      'customers.search': { method: 'get', path: '/customers', description: 'Search customers', input: z.object({ q: z.string(), tag: z.array(z.string()).optional() }) },
      'orders.create': { method: 'post', path: '/orders', description: 'Create an order', input: z.object({ sku: z.string(), quantity: z.number() }), approval: 'user-confirmation' },
      'legacy.login': { method: 'post', path: '/legacy/login', description: 'Legacy form endpoint', input: z.object({ user: z.string() }), bodyEncoding: 'form' },
      'broken.get': { method: 'get', path: '/broken', description: 'Declared output', output: z.object({ id: z.string() }) },
      'missing.get': { method: 'get', path: '/missing', description: 'Always 404' },
      'hidden.get': { method: 'get', path: '/hidden', description: 'Not exposed', enabled: false },
    },
    graphql: {
      operations: {
        'orders.byId': { description: 'Order by id', query: 'query ($id: ID!) { order(id: $id) { id status } }', variables: z.object({ id: z.string() }) },
        'orders.cancel': { description: 'Cancel an order', query: 'mutation ($id: ID!) { cancel(id: $id) { id } }', variables: z.object({ id: z.string() }) },
        'orders.failing': { description: 'Broken query', query: 'query { failing }' },
      },
    },
  });
}

describe('defineHttpApi', () => {
  it('turns declared endpoints into namespaced tools with safe security defaults', () => {
    const api = crm();
    expect(api.tools.map((definition) => definition.name).sort()).toEqual(['crm.broken.get', 'crm.customers.get', 'crm.customers.search', 'crm.legacy.login', 'crm.missing.get', 'crm.orders.byId', 'crm.orders.cancel', 'crm.orders.create', 'crm.orders.failing']);
    expect(tool(api.tools, 'crm.customers.get').security).toEqual({ risk: 'read-only', requiredPermissions: ['api.crm'] });
    expect(tool(api.tools, 'crm.orders.create').security).toEqual({ risk: 'write', requiredPermissions: ['api.crm'], approval: 'user-confirmation' });
    expect(tool(api.tools, 'crm.orders.cancel').security?.risk).toBe('write');
    expect(tool(api.tools, 'crm.orders.byId').security?.risk).toBe('read-only');
    expect(tool(api.tools, 'crm.customers.get').metadata).toMatchObject({ source: 'connector', executionLocation: 'server', readOnly: true });
    // Credentials never appear in what the model can fill in.
    expect(Object.keys((tool(api.tools, 'crm.customers.get').inputSchema as z.ZodObject).shape)).toEqual(['id']);
  });

  it('maps path, query and JSON body fields and sends credentials server-side', async () => {
    const api = crm();
    const customer = (await run(tool(api.tools, 'crm.customers.get'), { id: 'C 1/2' })) as { status: number; body: { id: string; token?: string } };
    expect(customer.status).toBe(200);
    expect(customer.body.id).toBe('C 1/2');
    // The echoed credential is redacted before it can reach the model.
    expect(JSON.stringify(customer)).not.toContain('tok-123');
    expect(seen.at(-1)?.url).toBe('/customers/C%201%2F2');
    expect(seen.at(-1)?.headers.authorization).toBe('Bearer tok-123');

    await run(tool(api.tools, 'crm.customers.search'), { q: 'om', tag: ['vip', 'eu'] });
    expect(seen.at(-1)?.url).toBe('/customers?q=om&tag=vip&tag=eu');

    const order = (await run(tool(api.tools, 'crm.orders.create'), { sku: 'A1', quantity: 2 })) as { status: number; body: unknown };
    expect(order).toEqual({ status: 201, body: { created: { sku: 'A1', quantity: 2 } } });
    expect(seen.at(-1)?.headers['content-type']).toBe('application/json');
  });

  it('sends form-encoded bodies for legacy endpoints', async () => {
    const result = (await run(tool(crm().tools, 'crm.legacy.login'), { user: 'a b' })) as { body: { form: string; type: string } };
    expect(result.body).toEqual({ form: 'user=a+b', type: 'application/x-www-form-urlencoded' });
  });

  it('runs GraphQL operations with developer-fixed documents and surfaces GraphQL errors', async () => {
    const api = crm();
    expect(await run(tool(api.tools, 'crm.orders.byId'), { id: 'O-7' })).toEqual({ status: 200, body: { order: { id: 'O-7', status: 'shipped' } } });
    expect(JSON.parse(seen.at(-1)?.body ?? '{}') as unknown).toMatchObject({ variables: { id: 'O-7' } });
    await expect(run(tool(api.tools, 'crm.orders.failing'), {})).rejects.toMatchObject({ code: 'TOOL_EXECUTION_ERROR' });
  });

  it('normalizes HTTP errors and rejects responses that break the declared schema', async () => {
    const api = crm();
    await expect(run(tool(api.tools, 'crm.missing.get'), {})).rejects.toMatchObject({ code: 'TOOL_EXECUTION_ERROR', message: expect.stringContaining('404') as string });
    await expect(run(tool(api.tools, 'crm.broken.get'), {})).rejects.toMatchObject({ code: 'TOOL_OUTPUT_INVALID' });
  });

  it('never lets input change the host (path values are encoded, dot segments refused)', async () => {
    const api = crm();
    const before = seen.length;
    await expect(run(tool(api.tools, 'crm.customers.get'), { id: '..' })).rejects.toThrow();
    expect(seen.length).toBe(before);
    await run(tool(api.tools, 'crm.customers.get'), { id: '//evil.example.com/x' });
    expect(seen.at(-1)?.url).toBe('/customers/%2F%2Fevil.example.com%2Fx');
  });

  it('validates definitions up front', () => {
    expect(() => defineHttpApi({ id: 'bad id', baseUrl })).toThrow(/Invalid API id/);
    expect(() => defineHttpApi({ id: 'x', baseUrl: 'ftp://host' })).toThrow(/http or https/);
    expect(() => defineHttpApi({ id: 'x', baseUrl, endpoints: { a: { method: 'get', path: '/a/{id}', description: 'A' } } })).toThrow(/placeholder \{id\}/);
    expect(() => defineHttpApi({ id: 'x', baseUrl, endpoints: { a: { method: 'get', path: '/a', description: ' ' } } })).toThrow(/description/);
  });

  it('registers and unregisters its tools in a registry', () => {
    const registry = createToolRegistry();
    const dispose = crm().register(registry);
    expect(registry.get('crm.customers.get')).toBeDefined();
    dispose();
    expect(registry.get('crm.customers.get')).toBeUndefined();
  });
});

describe('API manifests (JSON / YAML)', () => {
  const env = { CRM_URL: '', CRM_KEY: 'key-9' };

  it('builds tools from a YAML file, with URLs and credentials from the environment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'connectors-'));
    const file = join(dir, 'crm.api.yaml');
    await writeFile(
      file,
      [
        'id: crm',
        'baseUrl: ${env:CRM_URL}',
        'auth: { type: apiKey, header: X-API-Key, valueEnv: CRM_KEY }',
        'endpoints:',
        '  customers.get:',
        '    method: GET',
        '    path: /customers/{id}',
        '    description: Get one customer',
        '    permissions: [crm.read]',
        '    input:',
        '      type: object',
        '      properties: { id: { type: string } }',
        '      required: [id]',
      ].join('\n'),
    );
    const api = await loadHttpApiManifest(file, { env: { ...env, CRM_URL: baseUrl } });
    const get = tool(api.tools, 'crm.customers.get');
    expect(get.security).toEqual({ risk: 'read-only', requiredPermissions: ['crm.read'] });
    await run(get, { id: '42' });
    expect(seen.at(-1)?.headers['x-api-key']).toBe('key-9');
    expect(() => get.inputSchema.parse({})).toThrow();
  });

  it('rejects unknown keys, literal secrets and missing environment variables', () => {
    expect(() => httpApiFromManifest({ id: 'x', baseUrl, auth: { type: 'bearer', token: 'literal-secret' } })).toThrow(/Invalid API manifest/);
    expect(() => httpApiFromManifest({ id: 'x', baseUrl: '${env:NOPE}' }, { env: {} })).toThrow(/NOPE is not set/);
    expect(() => httpApiFromManifest({ id: 'x', baseUrl, extra: true })).toThrow(/Invalid API manifest/);
  });

  it('fails a call (not the load) when a credential variable is missing', async () => {
    const api = httpApiFromManifest({ id: 'crm', baseUrl, auth: { type: 'bearer', tokenEnv: 'MISSING_TOKEN' }, endpoints: { 'customers.get': { method: 'GET', path: '/customers/{id}', description: 'Get', input: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } } }, { env: {} });
    await expect(run(tool(api.tools, 'crm.customers.get'), { id: '1' })).rejects.toThrow();
  });
});
