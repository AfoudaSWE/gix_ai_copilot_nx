import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createFetchHttpExecutor } from './http-executor.js';
import { generateOpenAPITools } from './tool-generator.js';
import { resolveLocalRefs } from './ref-resolver.js';
import { createOpenAPILoader } from './loader.js';
import { validateOpenAPIDocument } from './validator.js';
import { buildOperationInputPlan } from './input-schema.js';

const document = { openapi: '3.1.0', servers: [{ url: 'https://example.com' }], paths: {
  '/records': { get: { operationId: 'read', responses: { '200': { content: { 'application/json': { schema: {
    type: 'object', properties: { count: { type: 'integer' }, secret: { type: 'string', writeOnly: true } }, required: ['count', 'secret'],
  } } } } } } },
} };
const context = { runId: 'run', signal: new AbortController().signal };

describe('OpenAPI security boundaries', () => {
  it('does not activate any operation without an explicit selection', async () => {
    const result = await generateOpenAPITools({ integrationId: 'test', source: { kind: 'object', document } });
    expect(result.report).toMatchObject({ generated: 0, denied: 1 });
  });
  it('validates output and excludes write-only response properties', async () => {
    let body: unknown = { count: 'invalid' };
    const result = await generateOpenAPITools({ integrationId: 'test', source: { kind: 'object', document }, include: ['read'],
      httpExecutor: { execute: () => Promise.resolve({ status: 200, headers: {}, body }) },
    });
    const tool = result.tools[0]; if (!tool) throw new Error('Expected generated tool');
    await expect(tool.execute({}, context)).rejects.toMatchObject({ code: 'TOOL_OUTPUT_INVALID' });
    body = { count: 1, secret: 'hidden' };
    expect(JSON.stringify(await tool.execute({}, context))).not.toContain('hidden');
  });
  it('never allows credential or destination headers into model input', () => {
    const result = buildOperationInputPlan({ method: 'get', path: '/', parameters: ['Authorization', 'HOST', 'x-api-key', 'Accept-Language'].map((name) => ({ name, in: 'header' as const, required: true, schema: { type: 'string' } })) },
      { allowedHeaderParameters: ['authorization', 'host', 'x-api-key', 'accept-language'] });
    expect(result.ok && result.plan.fields.map((field) => field.toolField)).toEqual(['Accept-Language']);
  });
  it('blocks dot path traversal and redirect following', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }));
    const executor = createFetchHttpExecutor({ fetchImpl });
    for (const value of ['.', '..']) await expect(executor.execute({ method: 'get', baseUrl: 'https://example.com/api', pathTemplate: '/{id}', pathParams: { id: value } })).rejects.toThrow('Dot segments');
    expect(fetchImpl).not.toHaveBeenCalled();
    await executor.execute({ method: 'get', baseUrl: 'https://example.com', pathTemplate: '/' });
    expect(fetchImpl.mock.calls[0]?.[1]?.redirect).toBe('error');
  });
  it('rejects excessive and malformed JSON response bodies', async () => {
    for (const body of ['x'.repeat(100), '{invalid']) {
      const executor = createFetchHttpExecutor({ maxResponseBytes: 20, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { headers: { 'content-type': 'application/json' } })) });
      await expect(executor.execute({ method: 'get', baseUrl: 'https://example.com', pathTemplate: '/' })).rejects.toThrow();
    }
  });
  it('cancels a real HTTP request and enforces its deadline', async () => {
    const server = createServer((_req, _res) => {});
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
    const request = { method: 'get' as const, baseUrl: `http://127.0.0.1:${address.port}`, pathTemplate: '/' };
    try {
      await expect(createFetchHttpExecutor().execute({ ...request, timeoutMs: 20 })).rejects.toMatchObject({ name: 'TimeoutError' });
      const controller = new AbortController();
      const pending = createFetchHttpExecutor().execute({ ...request, signal: controller.signal }); controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    } finally { server.closeAllConnections(); server.close(); }
  });
  it('loads YAML, resolves local references and rejects malformed structures and cycles', async () => {
    const loader = createOpenAPILoader({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response('openapi: 3.1.0\npaths: {}')) });
    expect(validateOpenAPIDocument(await loader.load({ kind: 'url', url: 'https://example.com/spec.yaml' })).ok).toBe(true);
    expect(resolveLocalRefs({ components: { X: { type: 'string' } }, input: { $ref: '#/components/X' } })).toMatchObject({ input: { type: 'string' } });
    expect(() => resolveLocalRefs({ X: { $ref: '#/X' } })).toThrow('Circular');
    expect(() => resolveLocalRefs({ X: { $ref: 'https://example.com/schema' } })).toThrow('only local');
    expect(validateOpenAPIDocument({ openapi: '3.10.0', paths: [] }).ok).toBe(false);
    expect(validateOpenAPIDocument({ openapi: '3.1.0', paths: { '/bad': { get: 'bad' } } }).ok).toBe(false);
  });
});


it('keeps credential headers authoritative and redacts echoed tokens', async () => {
  const result = await generateOpenAPITools({ integrationId: 'test', include: ['read'], source: { kind: 'object', document: {
    ...document, paths: { '/': { get: { operationId: 'read', parameters: [{ name: 'X-Custom-Key', in: 'header', schema: { type: 'string' } }] } } },
  } }, operations: { read: { allowedHeaderParameters: ['X-Custom-Key'] } },
  credentialProvider: { getCredentials: () => Promise.resolve({ kind: 'apiKey', headerName: 'x-custom-key', value: 'server-secret' }) },
  httpExecutor: { execute: (request) => { expect(request.headers).toEqual({ 'x-custom-key': 'server-secret' }); return Promise.resolve({ status: 200, headers: {}, body: { echoed: 'server-secret' } }); } },
  });
  const tool = result.tools[0]; if (!tool) throw new Error('Expected tool');
  expect(JSON.stringify(await tool.execute({ 'X-Custom-Key': 'model-forgery' }, context))).not.toContain('server-secret');
});
