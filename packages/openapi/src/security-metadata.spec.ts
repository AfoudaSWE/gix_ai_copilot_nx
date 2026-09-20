import { describe, expect, it } from 'vitest';
import { resolveOperationExposure } from './exposure-policy.js';
import { buildSecurityMetadata } from './security-metadata.js';
import type { OpenAPIOperationCandidate } from './types.js';

function candidate(overrides: Partial<OpenAPIOperationCandidate>): OpenAPIOperationCandidate {
  return {
    method: 'get',
    path: '/applications',
    parameters: [],
    ...overrides,
  };
}

describe('buildSecurityMetadata', () => {
  it('defaults risk from the HTTP method when no override risk is set', () => {
    const get = candidate({ method: 'get' });
    const post = candidate({ method: 'post' });
    const del = candidate({ method: 'delete', operationId: 'deleteApplication' });

    expect(buildSecurityMetadata(get, resolveOperationExposure(get), { integrationId: 'vas' }).risk).toBe('read-only');
    expect(buildSecurityMetadata(post, resolveOperationExposure(post), { integrationId: 'vas' }).risk).toBe('write');
    expect(
      buildSecurityMetadata(
        del,
        resolveOperationExposure(del, { operations: { deleteApplication: { expose: true } } }),
        { integrationId: 'vas' },
      ).risk,
    ).toBe('destructive');
  });

  it('never applies a permission-less manifest - falls back to a default scoped to the integration', () => {
    const op = candidate({ method: 'get', operationId: 'getApplication' });
    const metadata = buildSecurityMetadata(op, resolveOperationExposure(op), { integrationId: 'vas' });
    expect(metadata.requiredPermissions).toEqual(['openapi.vas']);
  });

  it('uses a custom default-permission function when provided', () => {
    const op = candidate({ method: 'get', operationId: 'getApplication' });
    const metadata = buildSecurityMetadata(op, resolveOperationExposure(op), {
      integrationId: 'vas',
      defaultPermission: (c) => `vas.${c.operationId ?? 'unknown'}`,
    });
    expect(metadata.requiredPermissions).toEqual(['vas.getApplication']);
  });

  it('prefers override.requiredPermissions over the default permission', () => {
    const op = candidate({ method: 'get', operationId: 'getApplication' });
    const metadata = buildSecurityMetadata(
      op,
      resolveOperationExposure(op, { operations: { getApplication: { requiredPermissions: ['applications.read'] } } }),
      { integrationId: 'vas' },
    );
    expect(metadata.requiredPermissions).toEqual(['applications.read']);
  });

  it('wraps a single override.permission into requiredPermissions', () => {
    const op = candidate({ method: 'post', operationId: 'assignApplication', path: '/applications/{id}/assign' });
    const metadata = buildSecurityMetadata(
      op,
      resolveOperationExposure(op, { operations: { assignApplication: { permission: 'applications.assign' } } }),
      { integrationId: 'vas' },
    );
    expect(metadata.requiredPermissions).toEqual(['applications.assign']);
  });

  it('leaves approval unset by default, letting the application risk policy compute it', () => {
    const op = candidate({ method: 'post', operationId: 'searchApplications' });
    const metadata = buildSecurityMetadata(op, resolveOperationExposure(op), { integrationId: 'vas' });
    expect(metadata.approval).toBeUndefined();
  });

  it('carries an explicit override.approval through unchanged', () => {
    const op = candidate({ method: 'post', operationId: 'assignApplication' });
    const metadata = buildSecurityMetadata(
      op,
      resolveOperationExposure(op, { operations: { assignApplication: { approval: 'supervisor' } } }),
      { integrationId: 'vas' },
    );
    expect(metadata.approval).toBe('supervisor');
  });

  it('leaves dataClassification unset unless the override provides one - never guessed from the path', () => {
    const op = candidate({ method: 'get', path: '/applications/{id}/ssn', operationId: 'getApplicationSsn' });
    const metadata = buildSecurityMetadata(op, resolveOperationExposure(op), { integrationId: 'vas' });
    expect(metadata.dataClassification).toBeUndefined();
  });

  it('carries an explicit override.dataClassification through unchanged', () => {
    const op = candidate({ method: 'get', operationId: 'getApplicationSsn' });
    const metadata = buildSecurityMetadata(
      op,
      resolveOperationExposure(op, { operations: { getApplicationSsn: { dataClassification: 'pii' } } }),
      { integrationId: 'vas' },
    );
    expect(metadata.dataClassification).toBe('pii');
  });
});
