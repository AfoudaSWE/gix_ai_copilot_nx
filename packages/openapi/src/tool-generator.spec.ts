import { describe, expect, it } from 'vitest';
import type { HttpExecutionRequest, HttpExecutionResult, HttpExecutor } from './http-executor.js';
import { generateOpenAPITools } from './tool-generator.js';
import type { GenerateOpenAPIToolsOptions } from './tool-generator.js';

const vasDocument = {
  openapi: '3.1.0',
  info: { title: 'VAS-like API', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com/v1' }],
  paths: {
    '/applications/{applicationId}': {
      get: {
        summary: 'Get an application by id',
        parameters: [{ name: 'applicationId', in: 'path', required: true, schema: { type: 'string' } }],
      },
      delete: {
        summary: 'Delete an application',
        parameters: [{ name: 'applicationId', in: 'path', required: true, schema: { type: 'string' } }],
      },
    },
    '/applications': {
      get: {
        summary: 'Search applications',
        parameters: [{ name: 'status', in: 'query', required: false, schema: { type: 'string' } }],
      },
    },
    '/applications/{applicationId}/assign': {
      post: {
        summary: 'Assign an application to an officer',
        parameters: [{ name: 'applicationId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', properties: { officerId: { type: 'string' } }, required: ['officerId'] },
            },
          },
        },
      },
    },
  },
};

function fakeHttpExecutor(handler: (request: HttpExecutionRequest) => HttpExecutionResult): HttpExecutor {
  return { execute: (request) => Promise.resolve(handler(request)) };
}

function baseOptions(overrides: Partial<GenerateOpenAPIToolsOptions> = {}): GenerateOpenAPIToolsOptions {
  return {
    integrationId: 'vas',
    source: { kind: 'object', document: vasDocument },
    namespace: 'vas',
    include: ['GET /applications/{applicationId}', 'DELETE /applications/{applicationId}', 'GET /applications', 'POST /applications/{applicationId}/assign', 'getApplicationNotes'],
    ...overrides,
  };
}

describe('generateOpenAPITools', () => {
  it('generates tools only for exposed operations, denying DELETE by default', async () => {
    const result = await generateOpenAPITools(baseOptions());
    const names = result.tools.map((tool) => tool.name).sort();
    expect(names).toEqual(['vas.applications.assign', 'vas.applications.getById', 'vas.applications.list']);
    expect(result.report.operationsDiscovered).toBe(4);
    expect(result.report.generated).toBe(3);
    expect(result.report.denied).toBe(1);
    expect(result.report.documentIssues).toEqual([]);
  });

  it('gives the GET operation risk "read-only" and the POST operation risk "write"', async () => {
    const result = await generateOpenAPITools(baseOptions());
    const get = result.tools.find((tool) => tool.name === 'vas.applications.getById');
    const post = result.tools.find((tool) => tool.name === 'vas.applications.assign');
    expect(get?.security?.risk).toBe('read-only');
    expect(post?.security?.risk).toBe('write');
  });

  it('never generates a permission-less tool - falls back to an integration-scoped default', async () => {
    const result = await generateOpenAPITools(baseOptions());
    for (const tool of result.tools) {
      expect(tool.security?.requiredPermissions).toEqual(['openapi.vas']);
    }
  });

  it('carries OpenAPI source metadata via ToolMetadata.custom', async () => {
    const result = await generateOpenAPITools(baseOptions());
    const get = result.tools.find((tool) => tool.name === 'vas.applications.getById');
    expect(get?.metadata?.source).toBe('openapi');
    expect(get?.metadata?.executionLocation).toBe('server');
    expect(get?.metadata?.custom).toMatchObject({
      sourceType: 'openapi',
      integrationId: 'vas',
      method: 'get',
      path: '/applications/{applicationId}',
      specVersion: '3.1.0',
    });
  });

  it('opts DELETE into approval (never allow) when explicitly enabled', async () => {
    const result = await generateOpenAPITools(
      baseOptions({
        operations: { 'DELETE /applications/{applicationId}': { expose: true, permission: 'applications.delete' } },
      }),
    );
    const del = result.tools.find((tool) => tool.name === 'vas.applications.remove');
    expect(del).toBeDefined();
    expect(del?.security?.risk).toBe('destructive');
  });

  it('routes path params, query params, and body to the HTTP executor correctly', async () => {
    let captured: HttpExecutionRequest | undefined;
    const httpExecutor = fakeHttpExecutor((request) => {
      captured = request;
      return { status: 200, headers: {}, body: { ok: true } };
    });
    const result = await generateOpenAPITools(baseOptions({ httpExecutor }));
    const assign = result.tools.find((tool) => tool.name === 'vas.applications.assign');
    expect(assign).toBeDefined();

    await assign?.execute(
      { applicationId: 'app-1', body: { officerId: 'off-1' } },
      { runId: 'run-1', signal: new AbortController().signal },
    );

    expect(captured?.pathParams).toEqual({ applicationId: 'app-1' });
    expect(captured?.body).toEqual({ officerId: 'off-1' });
    expect(captured?.baseUrl).toBe('https://api.example.com/v1');
    expect(captured?.pathTemplate).toBe('/applications/{applicationId}/assign');
  });

  it('merges credential headers into the request', async () => {
    let captured: HttpExecutionRequest | undefined;
    const httpExecutor = fakeHttpExecutor((request) => {
      captured = request;
      return { status: 200, headers: {}, body: {} };
    });
    const credentialProvider = { getCredentials: () => Promise.resolve({ kind: 'bearer' as const, token: 'secret-token' }) };
    const result = await generateOpenAPITools(baseOptions({ httpExecutor, credentialProvider }));
    const get = result.tools.find((tool) => tool.name === 'vas.applications.getById');

    await get?.execute({ applicationId: 'app-1' }, { runId: 'run-1', signal: new AbortController().signal });

    expect(captured?.headers?.['Authorization']).toBe('Bearer secret-token');
  });

  it('normalizes a 404 response into a thrown TOOL_EXECUTION_ERROR', async () => {
    const httpExecutor = fakeHttpExecutor(() => ({ status: 404, headers: {}, body: { message: 'not found' } }));
    const result = await generateOpenAPITools(baseOptions({ httpExecutor }));
    const get = result.tools.find((tool) => tool.name === 'vas.applications.getById');

    await expect(
      get?.execute({ applicationId: 'missing' }, { runId: 'run-1', signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'TOOL_EXECUTION_ERROR' });
  });

  it('applies transformResult to a successful response', async () => {
    const httpExecutor = fakeHttpExecutor(() => ({ status: 200, headers: {}, body: { id: 'app-1', secret: 'x' } }));
    const result = await generateOpenAPITools(
      baseOptions({
        httpExecutor,
        transformResult: (r) => {
          const body = r.body as { id: string };
          return { id: body.id };
        },
      }),
    );
    const get = result.tools.find((tool) => tool.name === 'vas.applications.getById');
    const output = await get?.execute({ applicationId: 'app-1' }, { runId: 'run-1', signal: new AbortController().signal });
    expect(output).toEqual({ id: 'app-1' });
  });

  it('adds a generated idempotency key header on a write operation when configured', async () => {
    let captured: HttpExecutionRequest | undefined;
    const httpExecutor = fakeHttpExecutor((request) => {
      captured = request;
      return { status: 200, headers: {}, body: {} };
    });
    const result = await generateOpenAPITools(baseOptions({ httpExecutor, idempotencyKeyHeader: 'Idempotency-Key' }));
    const assign = result.tools.find((tool) => tool.name === 'vas.applications.assign');
    await assign?.execute(
      { applicationId: 'app-1', body: { officerId: 'off-1' } },
      { runId: 'run-1', signal: new AbortController().signal },
    );
    expect(captured?.headers?.['Idempotency-Key']).toBeDefined();
  });

  it('does not add an idempotency key header on a GET', async () => {
    let captured: HttpExecutionRequest | undefined;
    const httpExecutor = fakeHttpExecutor((request) => {
      captured = request;
      return { status: 200, headers: {}, body: {} };
    });
    const result = await generateOpenAPITools(baseOptions({ httpExecutor, idempotencyKeyHeader: 'Idempotency-Key' }));
    const get = result.tools.find((tool) => tool.name === 'vas.applications.getById');
    await get?.execute({ applicationId: 'app-1' }, { runId: 'run-1', signal: new AbortController().signal });
    expect(captured?.headers?.['Idempotency-Key']).toBeUndefined();
  });

  it('retries a GET on a retryable status and returns the eventual success', async () => {
    let calls = 0;
    const httpExecutor = fakeHttpExecutor(() => {
      calls += 1;
      return calls < 2 ? { status: 503, headers: {}, body: {} } : { status: 200, headers: {}, body: { ok: true } };
    });
    const result = await generateOpenAPITools(
      baseOptions({ httpExecutor, retry: { maxAttempts: 3, baseDelayMs: 1 } }),
    );
    const get = result.tools.find((tool) => tool.name === 'vas.applications.getById');
    const output = await get?.execute({ applicationId: 'app-1' }, { runId: 'run-1', signal: new AbortController().signal });
    expect(output).toEqual({ status: 200, headers: {}, body: { ok: true } });
    expect(calls).toBe(2);
  });

  it('reports an unsupported operation (oneOf schema) with a warning and excludes it from tools', async () => {
    const document = {
      ...vasDocument,
      paths: {
        ...vasDocument.paths,
        '/applications/{applicationId}/notes': {
          get: {
            operationId: 'getApplicationNotes',
            parameters: [
              { name: 'applicationId', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'filter', in: 'query', required: false, schema: { oneOf: [{ type: 'string' }, { type: 'number' }] } },
            ],
          },
        },
      },
    };
    const result = await generateOpenAPITools(baseOptions({ source: { kind: 'object', document } }));
    expect(result.tools.some((tool) => tool.name.includes('Notes'))).toBe(false);
    expect(result.report.unsupported).toBe(1);
    expect(result.report.warnings).toHaveLength(1);
    expect(result.report.warnings[0]?.operation).toBe('getApplicationNotes');
  });

  it('detects a within-document naming conflict from colliding explicit overrides, excludes both, and still generates the rest', async () => {
    const result = await generateOpenAPITools(
      baseOptions({
        operations: {
          'GET /applications/{applicationId}': { name: 'duplicate' },
          'GET /applications': { name: 'duplicate' },
        },
      }),
    );
    expect(result.tools.some((tool) => tool.name === 'vas.duplicate')).toBe(false);
    expect(result.tools.some((tool) => tool.name === 'vas.applications.assign')).toBe(true);
    expect(result.report.skipped).toBe(2);
    expect(result.report.generated).toBe(1);
    expect(result.report.conflicts).toEqual([
      { name: 'vas.duplicate', operations: ['GET /applications/{applicationId}', 'GET /applications'] },
    ]);
  });

  it('returns a documentIssues-populated report and zero tools when no base URL is available', async () => {
    const document = { openapi: '3.1.0', paths: vasDocument.paths };
    const result = await generateOpenAPITools(baseOptions({ source: { kind: 'object', document } }));
    expect(result.tools).toEqual([]);
    expect(result.report.documentIssues.length).toBeGreaterThan(0);
    expect(result.report.generated).toBe(0);
  });

  it('returns a documentIssues-populated report for an invalid document', async () => {
    const result = await generateOpenAPITools(baseOptions({ source: { kind: 'object', document: { not: 'a spec' } } }));
    expect(result.tools).toEqual([]);
    expect(result.report.documentIssues.length).toBeGreaterThan(0);
  });

  it('respects an explicit exclude list even when include would otherwise allow it', async () => {
    const result = await generateOpenAPITools(
      baseOptions({
        include: ['GET /applications/{applicationId}', 'GET /applications'],
        exclude: ['GET /applications/{applicationId}'],
      }),
    );
    expect(result.tools.some((tool) => tool.name === 'vas.applications.getById')).toBe(false);
    expect(result.tools.some((tool) => tool.name === 'vas.applications.list')).toBe(true);
  });
});
