import { describe, expect, it } from 'vitest';
import { buildOperationInputPlan } from './input-schema.js';
import type { OpenAPIOperationCandidate } from './types.js';

function candidate(overrides: Partial<OpenAPIOperationCandidate>): OpenAPIOperationCandidate {
  return {
    method: 'get',
    path: '/applications',
    parameters: [],
    ...overrides,
  };
}

describe('buildOperationInputPlan', () => {
  it('exposes a required path parameter as a top-level required field', () => {
    const result = buildOperationInputPlan(
      candidate({
        parameters: [{ name: 'applicationId', in: 'path', required: true, schema: { type: 'string' } }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.fields).toEqual([{ toolField: 'applicationId', target: { kind: 'path', name: 'applicationId' } }]);
    expect(result.plan.schema.parse({ applicationId: 'abc' })).toEqual({ applicationId: 'abc' });
    expect(() => result.plan.schema.parse({})).toThrow();
  });

  it('exposes an optional query parameter as an optional field', () => {
    const result = buildOperationInputPlan(
      candidate({
        parameters: [{ name: 'status', in: 'query', required: false, schema: { type: 'string' } }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.schema.parse({})).toEqual({});
    expect(result.plan.schema.parse({ status: 'PENDING' })).toEqual({ status: 'PENDING' });
  });

  it('excludes header parameters by default', () => {
    const result = buildOperationInputPlan(
      candidate({
        parameters: [{ name: 'X-Trace-Id', in: 'header', required: false, schema: { type: 'string' } }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.fields).toEqual([]);
  });

  it('exposes an allowlisted header parameter', () => {
    const result = buildOperationInputPlan(
      candidate({
        parameters: [{ name: 'X-Trace-Id', in: 'header', required: false, schema: { type: 'string' } }],
      }),
      { allowedHeaderParameters: ['X-Trace-Id'] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.fields).toEqual([{ toolField: 'X-Trace-Id', target: { kind: 'header', name: 'X-Trace-Id' } }]);
  });

  it('always excludes cookie parameters, even when allowlisted by name', () => {
    const result = buildOperationInputPlan(
      candidate({
        parameters: [{ name: 'sessionId', in: 'cookie', required: false, schema: { type: 'string' } }],
      }),
      { allowedHeaderParameters: ['sessionId'] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.fields).toEqual([]);
  });

  it('nests a JSON request body under a "body" field', () => {
    const result = buildOperationInputPlan(
      candidate({
        method: 'post',
        path: '/applications/{applicationId}/assign',
        parameters: [{ name: 'applicationId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBodySchema: {
          type: 'object',
          properties: { officerId: { type: 'string' } },
          required: ['officerId'],
        },
        requestBodyRequired: true,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.fields).toEqual([
      { toolField: 'applicationId', target: { kind: 'path', name: 'applicationId' } },
      { toolField: 'body', target: { kind: 'body' } },
    ]);
    expect(result.plan.schema.parse({ applicationId: 'app-1', body: { officerId: 'off-1' } })).toEqual({
      applicationId: 'app-1',
      body: { officerId: 'off-1' },
    });
  });

  it('makes an optional request body an optional "body" field', () => {
    const result = buildOperationInputPlan(
      candidate({
        method: 'patch',
        requestBodySchema: { type: 'object', properties: { note: { type: 'string' } } },
        requestBodyRequired: false,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.schema.parse({})).toEqual({});
  });

  it('reports a conflict when a parameter is named "body" alongside a request body', () => {
    const result = buildOperationInputPlan(
      candidate({
        method: 'post',
        parameters: [{ name: 'body', in: 'query', required: false, schema: { type: 'string' } }],
        requestBodySchema: { type: 'object', properties: {} },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      { path: '$.body', reason: 'A parameter is already named "body", which collides with the request body field.' },
    ]);
  });

  it('reports a conflict when two parameters in different locations share a name', () => {
    const result = buildOperationInputPlan(
      candidate({
        parameters: [
          { name: 'status', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'status', in: 'header', required: false, schema: { type: 'string' } },
        ],
      }),
      { allowedHeaderParameters: ['status'] },
    );
    expect(result.ok).toBe(false);
  });

  it('propagates a JSON Schema conversion issue for an unsupported parameter schema', () => {
    const result = buildOperationInputPlan(
      candidate({
        parameters: [{ name: 'filter', in: 'query', required: false, schema: { oneOf: [{ type: 'string' }, { type: 'number' }] } }],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.path).toBe('$.filter');
  });

  it('returns an empty schema for an operation with no parameters or body', () => {
    const result = buildOperationInputPlan(candidate({}));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.fields).toEqual([]);
    expect(result.plan.schema.parse({})).toEqual({});
  });
});
