import { afterEach, describe, expect, it } from 'vitest';
import { discoverProject } from './discovery/discover.js';
import type { DiscoveredProject } from './discovery/model.js';
import { compareDiscoveries } from './discovery/rescan.js';
import { ANGULAR_FIXTURE, createFixture, EXPRESS_NEST_FIXTURE, NX_FIXTURE, removeFixture, snapshot, VUE_FIXTURE } from './fixtures.spec-helper.js';
import { createReadonlyWorkspace } from './workspace/workspace.js';

const roots: string[] = [];
async function discover(files: Readonly<Record<string, string>>): Promise<{ root: string; project: DiscoveredProject }> {
  const root = createFixture(files);
  roots.push(root);
  return { root, project: await discoverProject(createReadonlyWorkspace(root)) };
}
afterEach(() => {
  for (const root of roots.splice(0)) removeFixture(root);
});

const operations = (project: DiscoveredProject) => project.apis.flatMap((source) => source.operations);
const keys = (project: DiscoveredProject, kind?: string) =>
  operations(project)
    .filter((operation) => !kind || operation.sourceKind === kind)
    .map((operation) => `${operation.method} ${operation.path}`)
    .sort();

describe('project discovery: Nx + React + Fastify', () => {
  it('detects the workspace, frameworks, language and package manager', async () => {
    const { project } = await discover(NX_FIXTURE);
    expect(project.workspace).toMatchObject({ name: 'customer-portal', kind: 'nx', packageManager: 'pnpm', language: 'typescript' });
    const ids = project.frameworks.map((framework) => framework.id);
    expect(ids).toEqual(expect.arrayContaining(['nx', 'react', 'fastify', 'node', 'vite', 'typescript']));
    expect(project.applications.map((unit) => unit.name).sort()).toEqual(['api', 'web']);
    expect(project.libraries.map((unit) => unit.name)).toEqual(['ui']);
    expect(project.commands.typecheck).toEqual({ command: 'pnpm', args: ['run', 'typecheck'] });
    expect(project.gix.packages).toEqual(['@gixcopilot/react']);
    expect(project.tests).toMatchObject({ frameworks: ['vitest'], files: 1 });
  });

  it('finds backend routes with their permissions and authentication, and frontend API calls', async () => {
    const { project } = await discover(NX_FIXTURE);
    expect(keys(project, 'backend-route')).toEqual(['DELETE /appointments/{id}', 'GET /applications', 'GET /payments/{id}/status', 'POST /applications']);
    const list = operations(project).find((operation) => operation.sourceKind === 'backend-route' && operation.path === '/applications' && operation.method === 'GET');
    expect(list).toMatchObject({ permissions: ['APPLICATION_VIEW'], authentication: 'required', source: 'routes' });
    expect(operations(project).find((operation) => operation.path === '/appointments/{id}' && operation.sourceKind === 'backend-route')?.authentication).toBe('required');
    expect(keys(project, 'frontend-client')).toEqual(['DELETE /api/appointments/{id}', 'GET /api/applications', 'GET /api/payments/{id}/status']);
  });

  it('reads OpenAPI documents through @gixcopilot/openapi, with schemas and declared permissions', async () => {
    const { project } = await discover(NX_FIXTURE);
    const spec = project.apis.find((source) => source.kind === 'openapi');
    expect(spec?.title).toBe('Applications API');
    expect(spec?.operations.map((operation) => `${operation.method} ${operation.path}`)).toEqual(['GET /applications', 'POST /applications', 'GET /applications/{id}', 'PUT /applications/{id}', 'DELETE /applications/{id}']);
    const create = spec?.operations.find((operation) => operation.operationId === 'createApplication');
    expect(create?.input).toMatchObject({ properties: { body: { properties: { name: { type: 'string' } } } }, required: ['body'] });
    expect(spec?.operations[0]?.permissions).toEqual(['APPLICATION_VIEW']);
  });

  it('finds frontend routes, component candidates, context candidates and permissions', async () => {
    const { project } = await discover(NX_FIXTURE);
    expect(project.routes.filter((route) => route.kind === 'frontend').map((route) => route.path)).toEqual(['/', '/applications/:id']);
    const card = project.components.find((component) => component.name === 'PaymentStatusCard');
    expect(card).toMatchObject({ framework: 'react', candidate: true });
    expect(card?.props.map((prop) => prop.name)).toEqual(['paymentId', 'amount', 'status', 'note']);
    expect(project.components.find((component) => component.name === 'AppLayout')?.candidate).toBe(false);
    expect(project.components.find((component) => component.name === 'ActionButton')?.reason).toMatch(/onClick/);
    expect(project.components.find((component) => component.name === 'InternalBadge')?.reason).toBe('not exported');
    const context = Object.fromEntries(project.contextCandidates.map((candidate) => [candidate.name, candidate.kind]));
    expect(context).toMatchObject({ useCurrentUser: 'user', useTenant: 'tenant', selectedApplication: 'entity', usePermissions: 'permissions' });
    expect(project.permissions.map((permission) => permission.name)).toEqual(expect.arrayContaining(['APPLICATION_VIEW', 'APPLICATION_CREATE', 'APPLICATION_UPDATE', 'APPLICATION_DELETE', 'PAYMENT_VIEW']));
    expect(project.permissions.find((permission) => permission.name === 'APPLICATION_VIEW')?.value).toBe('application:view');
  });

  it('analyzes authentication without exposing any secret value', async () => {
    const { project } = await discover(NX_FIXTURE);
    expect(project.authentication).toMatchObject({ libraries: ['@fastify/jwt'], mechanisms: ['JWT'], userModel: { name: 'User' } });
    expect(project.authentication?.tokenHandling).toContain('Token kept in localStorage');
    expect(JSON.stringify(project)).not.toContain('FAKE_SECRET');
  });

  it('lists knowledge candidates without indexing them', async () => {
    const { project } = await discover(NX_FIXTURE);
    expect(project.knowledgeSources.map((source) => source.path).sort()).toEqual(['README.md', 'docs/appointments/faq.md', 'docs/payments/guide.md', 'openapi.yaml']);
    expect(project.knowledgeSources.find((source) => source.path === 'README.md')?.title).toBe('Customer Portal');
  });

  it('skips secrets, node_modules, build output and gitignored files', async () => {
    const { project } = await discover(NX_FIXTURE);
    const text = JSON.stringify(project);
    for (const hidden of ['should-not-be-found', 'built-output', 'ignored-by-gitignore', 'server.log']) expect(text).not.toContain(hidden);
    expect(project.diagnostics.find((diagnostic) => diagnostic.code === 'SECRETS_SKIPPED')?.message).toMatch(/1 secret file/);
  });

  it('is read-only: the repository is byte-identical afterwards', async () => {
    const root = createFixture(NX_FIXTURE);
    roots.push(root);
    const before = snapshot(root);
    await discoverProject(createReadonlyWorkspace(root));
    expect(snapshot(root)).toEqual(before);
  });

  it('supports cancellation', async () => {
    const root = createFixture(NX_FIXTURE);
    roots.push(root);
    const controller = new AbortController();
    controller.abort();
    await expect(discoverProject(createReadonlyWorkspace(root), { signal: controller.signal })).rejects.toThrow();
  });
});

describe('project discovery: other stacks', () => {
  it('Angular: components with @Input and signal inputs, HttpClient calls, routes and ActivatedRoute', async () => {
    const { project } = await discover(ANGULAR_FIXTURE);
    expect(project.frameworks.map((framework) => framework.id)).toEqual(expect.arrayContaining(['angular', 'typescript']));
    expect(project.workspace).toMatchObject({ kind: 'single', packageManager: 'npm' });
    const summary = project.components.find((component) => component.name === 'ApplicationSummaryComponent');
    expect(summary).toMatchObject({ framework: 'angular', candidate: true });
    expect(summary?.props).toEqual([
      { name: 'title', type: 'string', optional: true },
      { name: 'count', type: 'number', optional: false },
    ]);
    expect(keys(project, 'frontend-client')).toEqual(['GET /api/applications', 'PUT /api/applications/{id}']);
    expect(project.routes.map((route) => route.path)).toEqual(['/applications', '/applications/:id']);
    expect(project.contextCandidates.map((candidate) => candidate.name)).toEqual(expect.arrayContaining(['currentUser', 'ActivatedRoute']));
  });

  it('Vue: defineProps components, axios calls and a Pinia store; JavaScript project', async () => {
    const { project } = await discover(VUE_FIXTURE);
    expect(project.workspace).toMatchObject({ packageManager: 'yarn', language: 'javascript' });
    expect(project.frameworks.map((framework) => framework.id)).toEqual(expect.arrayContaining(['vue', 'vite', 'javascript']));
    const list = project.components.find((component) => component.name === 'AppointmentList');
    expect(list).toMatchObject({ framework: 'vue', candidate: true });
    expect(list?.props.map((prop) => prop.name)).toEqual(['appointments', 'title', 'compact']);
    expect(keys(project)).toEqual(['GET /api/appointments']);
    expect(project.contextCandidates.find((candidate) => candidate.name === 'useSessionStore')?.kind).toBe('user');
  });

  it('Express and NestJS: routes, guards and route-level permissions', async () => {
    const { project } = await discover(EXPRESS_NEST_FIXTURE);
    expect(project.frameworks.map((framework) => framework.id)).toEqual(expect.arrayContaining(['express', 'nestjs', 'node']));
    expect(keys(project, 'backend-route')).toEqual(['DELETE /customers/{id}', 'GET /customers', 'GET /customers/{id}', 'POST /customers']);
    const remove = operations(project).find((operation) => operation.method === 'DELETE');
    expect(remove).toMatchObject({ permissions: ['CUSTOMER_DELETE'], authentication: 'required' });
    expect(operations(project).find((operation) => operation.method === 'POST')).toMatchObject({ authentication: 'required', operationId: 'create' });
    expect(project.authentication?.libraries).toEqual(['passport']);
    expect(project.tests.frameworks).toEqual(['jest']);
    expect(project.commands).toEqual({ build: { command: 'npm', args: ['run', 'build'] } });
  });
});

describe('re-scan (§61)', () => {
  it('reports new, changed and removed APIs and components, and new permissions/context', async () => {
    const before = (await discover(NX_FIXTURE)).project;
    const after = (
      await discover({
        ...NX_FIXTURE,
        'apps/api/src/routes.ts': `export async function routes(app: any) {
  app.get('/applications', { preHandler: app.authenticate }, async () => requirePermission('APPLICATION_VIEW', 'APPLICATION_EXPORT'));
  app.get('/invoices', async () => ({}));
}
declare function requirePermission(...permissions: string[]): unknown;
`,
        'apps/web/src/state/session.ts': NX_FIXTURE['apps/web/src/state/session.ts'] + 'export const selectedInvoice = { id: 1 };\n',
      })
    ).project;
    const comparison = compareDiscoveries(before, after);
    expect(comparison.newApis.map((operation) => `${operation.method} ${operation.path}`)).toEqual(['GET /invoices']);
    expect(comparison.changedApis.map((operation) => `${operation.method} ${operation.path}`)).toEqual(['GET /applications']);
    expect(comparison.removedApis.map((operation) => `${operation.method} ${operation.path}`).sort()).toEqual(['DELETE /appointments/{id}', 'GET /payments/{id}/status', 'POST /applications']);
    expect(comparison.newPermissions.map((permission) => permission.name)).toEqual(['APPLICATION_EXPORT']);
    expect(comparison.newContextCandidates.map((candidate) => candidate.name)).toEqual(['selectedInvoice']);
    expect(compareDiscoveries(after, after).unchanged).toBe(true);
  });
});
