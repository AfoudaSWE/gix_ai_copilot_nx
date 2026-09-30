import { afterEach, describe, expect, it } from 'vitest';
import { classifyProject } from './discovery/classify.js';
import { discoverProject } from './discovery/discover.js';
import type { DiscoveredProject } from './discovery/model.js';
import { canonicalOperationKey } from './discovery/normalize.js';
import { ANGULAR_FIXTURE, createFixture, EXPRESS_NEST_FIXTURE, FULL_STACK_FIXTURE, NEXT_FIXTURE, NX_FIXTURE, PORTAL_FIXTURE, removeFixture, snapshot, VUE_FIXTURE } from './fixtures.spec-helper.js';
import { createReadonlyWorkspace } from './workspace/workspace.js';

const roots: string[] = [];
async function discover(files: Readonly<Record<string, string>>): Promise<DiscoveredProject> {
  const root = createFixture(files);
  roots.push(root);
  return discoverProject(createReadonlyWorkspace(root));
}
afterEach(() => {
  for (const root of roots.splice(0)) removeFixture(root);
});

describe('project classification (§4-5)', () => {
  it('classifies every supported shape', async () => {
    const portal = classifyProject(await discover(PORTAL_FIXTURE));
    expect(portal.classification).toBe('NX_MONOREPO');
    expect(portal.applications.map((app) => `${app.name}:${app.role}:${app.ui ?? app.backend ?? ''}`).sort()).toEqual(['api:backend:fastify', 'portal:frontend:react']);
    expect(classifyProject(await discover(FULL_STACK_FIXTURE))).toMatchObject({ classification: 'FULL_STACK', frontends: [{ path: 'client', ui: 'vue' }], backends: [{ path: 'server', backend: 'express' }] });
    expect(classifyProject(await discover(ANGULAR_FIXTURE))).toMatchObject({ classification: 'FRONTEND_ONLY', frontends: [{ ui: 'angular' }] });
    expect(classifyProject(await discover(VUE_FIXTURE)).classification).toBe('FRONTEND_ONLY');
    const backend = classifyProject(await discover(EXPRESS_NEST_FIXTURE));
    expect(backend).toMatchObject({ classification: 'BACKEND_ONLY', frontends: [] });
    expect(classifyProject(await discover(NEXT_FIXTURE))).toMatchObject({ classification: 'FULL_STACK', applications: [{ role: 'full-stack', ui: 'nextjs', backend: 'nextjs' }] });
    expect(classifyProject(await discover({ 'package.json': '{"name":"empty"}' })).classification).toBe('UNKNOWN');
    expect(classifyProject(await discover(NX_FIXTURE)).classification).toBe('NX_MONOREPO');
  });
});

describe('API sources and normalization (§16-22)', () => {
  it('reads OpenAPI 3, Swagger 2 and Postman, and merges them with routes and client calls', async () => {
    const project = await discover(PORTAL_FIXTURE);
    expect(project.apis.map((source) => source.kind).sort()).toEqual(['backend-route', 'frontend-client', 'frontend-client', 'openapi', 'postman', 'swagger']);
    const swagger = project.apis.find((source) => source.kind === 'swagger');
    expect(swagger?.operations[0]).toMatchObject({ method: 'GET', path: '/payments/{applicationId}', operationId: 'getPaymentStatus', input: { required: ['applicationId'] } });
    const postman = project.apis.find((source) => source.kind === 'postman');
    expect(postman).toMatchObject({ title: 'Admin API' });
    expect(postman?.operations.map((operation) => `${operation.method} ${operation.path} ${operation.authentication ?? ''}`)).toEqual(['PATCH /applications/{id} declared', 'POST /system/reset declared']);

    const byKey = new Map(project.operations.map((operation) => [operation.key, operation]));
    // Seven unique operations, however many sources describe them.
    expect(project.operations).toHaveLength(8);
    const get = byKey.get('GET /applications/{}');
    expect(get).toMatchObject({ path: '/applications/{id}', operationId: 'getApplication', confidence: 'high', conflicts: [] });
    expect(get?.sources.map((source) => source.kind)).toEqual(['openapi', 'backend-route', 'frontend-client']);
    // OpenAPI says `status`, Postman sends `state`: shown as a conflict, not merged.
    const patch = byKey.get('PATCH /applications/{}');
    expect(patch?.confidence).toBe('review');
    expect(patch?.conflicts[0]).toMatch(/Request fields differ: openapi .* \[<param>,status\], postman .* \[<param>,state\]/);
    expect(byKey.get('POST /system/{}')).toBeUndefined();
    expect(byKey.get('POST /system/reset')).toMatchObject({ confidence: 'medium' });
    expect(byKey.get('GET /payments/{}')).toMatchObject({ confidence: 'high', operationId: 'getPaymentStatus' });
    expect(project.diagnostics.map((diagnostic) => diagnostic.code)).toContain('API_CONFLICTS');
  });

  it('keys operations independently of /api and version prefixes and parameter names', () => {
    expect(canonicalOperationKey('get', '/api/v2/users/:userId/')).toBe('GET /users/{}');
    expect(canonicalOperationKey('GET', '/users/{id}')).toBe('GET /users/{}');
  });

  it('reads Next.js file routes and route handlers', async () => {
    const project = await discover(NEXT_FIXTURE);
    expect(project.routes.filter((route) => route.kind === 'frontend').map((route) => route.path).sort()).toEqual(['/', '/orders/{id}']);
    // pages/api/health.ts only checks for POST, so that is the method reported.
    expect(project.operations.map((operation) => operation.key)).toEqual(['DELETE /orders/{}', 'GET /orders', 'POST /health', 'POST /orders']);
  });
});

describe('page analysis (§29-31)', () => {
  it('maps routes to page components, the APIs they call and context candidates', async () => {
    const project = await discover(PORTAL_FIXTURE);
    expect(project.pages.map((page) => page.route)).toEqual(['/applications/:id', '/dashboard', '/payments']);
    const details = project.pages.find((page) => page.route === '/applications/:id');
    expect(details).toMatchObject({ component: 'ApplicationDetails', file: 'apps/portal/src/pages/ApplicationDetails.tsx', params: ['id'], entity: 'application' });
    expect(details?.operations).toEqual(['GET /applications/{}', 'GET /applications/{}/documents', 'GET /payments/{}']);
    expect(details?.contextCandidates).toEqual(['applicationId', 'currentApplication']);
    expect(project.pages.find((page) => page.route === '/dashboard')?.operations).toEqual([]);
  });

  it('stays read-only', async () => {
    const root = createFixture(PORTAL_FIXTURE);
    roots.push(root);
    const before = snapshot(root);
    await discoverProject(createReadonlyWorkspace(root));
    expect(snapshot(root)).toEqual(before);
  });
});
