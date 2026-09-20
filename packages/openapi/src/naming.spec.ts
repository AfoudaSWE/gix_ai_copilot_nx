import { describe, expect, it } from 'vitest';
import { deriveToolName, detectNamingConflicts, operationKey } from './naming.js';
import type { OpenAPIOperationCandidate } from './types.js';

function candidate(overrides: Partial<OpenAPIOperationCandidate>): OpenAPIOperationCandidate {
  return {
    method: 'get',
    path: '/applications',
    parameters: [],
    ...overrides,
  };
}

describe('operationKey', () => {
  it('uses operationId when present', () => {
    expect(operationKey(candidate({ operationId: 'getApplication' }))).toBe('getApplication');
  });

  it('falls back to METHOD path when operationId is missing', () => {
    expect(operationKey(candidate({ method: 'post', path: '/applications/{id}/assign' }))).toBe(
      'POST /applications/{id}/assign',
    );
  });
});

describe('deriveToolName', () => {
  it('prefers a valid operationId, sanitized', () => {
    expect(deriveToolName(candidate({ operationId: 'get-application' }))).toBe('getApplication');
  });

  it('applies an explicit namespace to an operationId-based name', () => {
    expect(deriveToolName(candidate({ operationId: 'getApplication' }), { namespace: 'vas' })).toBe(
      'vas.getApplication',
    );
  });

  it('an explicit override name always wins over operationId', () => {
    expect(
      deriveToolName(candidate({ operationId: 'getApplication' }), { overrideName: 'fetchApplication' }),
    ).toBe('fetchApplication');
  });

  it('derives getById for GET on a single-resource path with no operationId', () => {
    expect(deriveToolName(candidate({ method: 'get', path: '/applications/{applicationId}' }))).toBe(
      'applications.getById',
    );
  });

  it('derives list for GET on a collection path with no operationId', () => {
    expect(deriveToolName(candidate({ method: 'get', path: '/applications' }))).toBe('applications.list');
  });

  it('derives create for POST on a collection path', () => {
    expect(deriveToolName(candidate({ method: 'post', path: '/applications' }))).toBe('applications.create');
  });

  it('derives update for PATCH on a single-resource path', () => {
    expect(
      deriveToolName(candidate({ method: 'patch', path: '/applications/{applicationId}' })),
    ).toBe('applications.update');
  });

  it('derives remove for DELETE on a single-resource path', () => {
    expect(
      deriveToolName(candidate({ method: 'delete', path: '/applications/{applicationId}' })),
    ).toBe('applications.remove');
  });

  it('uses the trailing literal segment as the action verb for a sub-resource action', () => {
    expect(
      deriveToolName(
        candidate({ method: 'post', path: '/applications/{applicationId}/assign' }),
        { namespace: 'vas' },
      ),
    ).toBe('vas.applications.assign');
  });

  it('folds multiple nested literal segments into dot-separated namespace segments', () => {
    expect(
      deriveToolName(candidate({ method: 'get', path: '/orgs/{orgId}/teams/{teamId}/members' })),
    ).toBe('orgs.teams.members.list');
  });

  it('a POST after a param uses the trailing literal as the verb even for a nested-create, staying distinct from GET/list', () => {
    const list = deriveToolName(candidate({ method: 'get', path: '/orgs/{orgId}/members' }));
    const create = deriveToolName(candidate({ method: 'post', path: '/orgs/{orgId}/members' }));
    expect(list).toBe('orgs.members.list');
    expect(create).toBe('orgs.members');
    expect(list).not.toBe(create);
  });

  it('falls back to "root" for a path with no literal segments', () => {
    expect(deriveToolName(candidate({ method: 'get', path: '/{id}' }))).toBe('root.getById');
  });

  it('is stable across repeated derivations for the same candidate', () => {
    const op = candidate({ method: 'post', path: '/applications/{applicationId}/assign' });
    expect(deriveToolName(op)).toBe(deriveToolName(op));
  });
});

describe('detectNamingConflicts', () => {
  it('reports no conflicts when all names are unique', () => {
    expect(
      detectNamingConflicts([
        { name: 'applications.list', operation: 'GET /applications' },
        { name: 'applications.create', operation: 'POST /applications' },
      ]),
    ).toEqual([]);
  });

  it('reports a conflict when two operations resolve to the same name', () => {
    const conflicts = detectNamingConflicts([
      { name: 'getApplication', operation: 'GET /a/applications/{id}' },
      { name: 'getApplication', operation: 'GET /b/applications/{id}' },
    ]);
    expect(conflicts).toEqual([
      { name: 'getApplication', operations: ['GET /a/applications/{id}', 'GET /b/applications/{id}'] },
    ]);
  });
});
