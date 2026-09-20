import { describe, expect, it } from 'vitest';
import { resolveOperationExposure } from './exposure-policy.js';
import type { OpenAPIOperationCandidate } from './types.js';

function candidate(overrides: Partial<OpenAPIOperationCandidate>): OpenAPIOperationCandidate {
  return {
    method: 'get',
    path: '/applications',
    parameters: [],
    ...overrides,
  };
}

describe('resolveOperationExposure', () => {
  it('defaults GET to allow', () => {
    expect(resolveOperationExposure(candidate({ method: 'get' })).exposure).toBe('allow');
  });

  it('defaults POST/PUT/PATCH to approval', () => {
    expect(resolveOperationExposure(candidate({ method: 'post' })).exposure).toBe('approval');
    expect(resolveOperationExposure(candidate({ method: 'put' })).exposure).toBe('approval');
    expect(resolveOperationExposure(candidate({ method: 'patch' })).exposure).toBe('approval');
  });

  it('defaults DELETE to deny', () => {
    expect(resolveOperationExposure(candidate({ method: 'delete' })).exposure).toBe('deny');
  });

  it('defaults HEAD/OPTIONS/TRACE to deny', () => {
    expect(resolveOperationExposure(candidate({ method: 'head' })).exposure).toBe('deny');
    expect(resolveOperationExposure(candidate({ method: 'options' })).exposure).toBe('deny');
    expect(resolveOperationExposure(candidate({ method: 'trace' })).exposure).toBe('deny');
  });

  it('respects a caller-supplied method policy override', () => {
    const result = resolveOperationExposure(candidate({ method: 'delete' }), { policies: { delete: 'allow' } });
    expect(result.exposure).toBe('allow');
  });

  it('an explicit expose:true on a deny-by-default method (DELETE) opts in to approval, not allow', () => {
    const result = resolveOperationExposure(
      candidate({ method: 'delete', operationId: 'deleteApplication' }),
      { operations: { deleteApplication: { expose: true } } },
    );
    expect(result.exposure).toBe('approval');
  });

  it('exclude always wins, even if the same key is also included', () => {
    const result = resolveOperationExposure(candidate({ operationId: 'getApplication' }), {
      include: ['getApplication'],
      exclude: ['getApplication'],
    });
    expect(result.exposure).toBe('deny');
  });

  it('a key absent from an explicit include list is denied', () => {
    const result = resolveOperationExposure(candidate({ operationId: 'getApplication' }), {
      include: ['searchApplications'],
    });
    expect(result.exposure).toBe('deny');
  });

  it('a key present in an explicit include list is not denied by the allowlist itself', () => {
    const result = resolveOperationExposure(candidate({ method: 'get', operationId: 'getApplication' }), {
      include: ['getApplication'],
    });
    expect(result.exposure).toBe('allow');
  });

  it('operations[key].expose === false denies regardless of method policy', () => {
    const result = resolveOperationExposure(candidate({ method: 'get', operationId: 'getApplication' }), {
      operations: { getApplication: { expose: false } },
    });
    expect(result.exposure).toBe('deny');
  });

  it('an override with approval: "none" allows an operation that would otherwise require approval', () => {
    const result = resolveOperationExposure(candidate({ method: 'post', operationId: 'searchApplications' }), {
      operations: { searchApplications: { approval: 'none' } },
    });
    expect(result.exposure).toBe('allow');
  });

  it('an override with an explicit approval level forces approval even on a normally-allow GET', () => {
    const result = resolveOperationExposure(candidate({ method: 'get', operationId: 'getApplicationPii' }), {
      operations: { getApplicationPii: { approval: 'supervisor' } },
    });
    expect(result.exposure).toBe('approval');
  });

  it('uses METHOD + PATH as the operation key when operationId is missing, for include/exclude/overrides', () => {
    const result = resolveOperationExposure(
      candidate({ method: 'post', path: '/applications/{id}/assign', operationId: undefined }),
      { operations: { 'POST /applications/{id}/assign': { approval: 'supervisor' } } },
    );
    expect(result.exposure).toBe('approval');
    expect(result.override).toEqual({ approval: 'supervisor' });
  });

  it('carries the resolved override through the decision for downstream security-metadata mapping', () => {
    const override = { permission: 'applications.assign', approval: 'supervisor' as const, risk: 'write' as const };
    const result = resolveOperationExposure(candidate({ method: 'post', operationId: 'assignApplication' }), {
      operations: { assignApplication: override },
    });
    expect(result.override).toEqual(override);
  });
});
