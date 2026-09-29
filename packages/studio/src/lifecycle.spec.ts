import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandRunner } from './apply/engine.js';
import { ApplyRefusedError, createApplyEngine } from './apply/engine.js';
import { createFixture, NX_FIXTURE, removeFixture, snapshot } from './fixtures.spec-helper.js';
import { approvalFloor, suggestPermission, suggestRisk, toolNameFor } from './generators/risk.js';
import type { ChangeProposal } from './proposals/model.js';
import { ProposalStateError } from './proposals/store.js';
import { createStudioService, DEFAULT_GENERATORS, StudioApprovalError } from './service.js';
import type { StudioService } from './service.js';
import { createWorkspaceGuard, WorkspaceViolationError } from './workspace/guard.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeFixture(root);
});

const passing: CommandRunner = () => Promise.resolve({ exitCode: 0, output: 'ok' });
const failingTests: CommandRunner = (command) => Promise.resolve(command.args.includes('test') ? { exitCode: 1, output: '1 test failed\nOPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789' } : { exitCode: 0, output: '' });

function studio(runner: CommandRunner = passing, files: Readonly<Record<string, string>> = NX_FIXTURE): { root: string; service: StudioService } {
  const root = createFixture(files);
  roots.push(root);
  return { root, service: createStudioService({ root, commandRunner: runner, facts: () => ({ runtime: true, server: true, firewall: true, devtools: false }) }) };
}

describe('risk heuristics and naming (§33-34)', () => {
  it('maps methods to risk and risk to the Action Firewall default approval', () => {
    expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(suggestRisk)).toEqual(['read-only', 'write', 'write', 'write', 'destructive']);
    expect(['read-only', 'write', 'destructive'].map((risk) => approvalFloor(risk as 'write'))).toEqual(['none', 'user-confirmation', 'admin']);
  });

  it('names tools readably and never inside a development namespace', () => {
    expect(toolNameFor('GET', '/applications')).toBe('applications.list');
    expect(toolNameFor('GET', '/api/v1/applications/{id}')).toBe('applications.get');
    expect(toolNameFor('POST', '/applications')).toBe('applications.create');
    expect(toolNameFor('PUT', '/applications/{id}')).toBe('applications.update');
    expect(toolNameFor('DELETE', '/applications/{id}')).toBe('applications.delete');
    expect(toolNameFor('POST', '/applications/{id}/assign')).toBe('applications.assign');
    expect(toolNameFor('GET', '/payments/{id}/status')).toBe('payments.status.list');
    expect(toolNameFor('GET', '/repo/files')).toBe('app.repo.files.list');
  });

  it('matches discovered permissions and flags invented ones', () => {
    const known = ['APPLICATION_VIEW', 'APPLICATION_CREATE', 'application:update'];
    expect(suggestPermission('GET', '/applications', [], known)).toEqual({ permission: 'APPLICATION_VIEW', discovered: true });
    expect(suggestPermission('PUT', '/applications/{id}', [], known)).toEqual({ permission: 'application:update', discovered: true });
    expect(suggestPermission('DELETE', '/applications/{id}', [], known)).toEqual({ permission: 'APPLICATION_DELETE', discovered: false });
    expect(suggestPermission('GET', '/x', ['CUSTOM'], known)).toEqual({ permission: 'CUSTOM', discovered: true });
  });
});

describe('generators (§30-45, §74)', () => {
  it('every generator produces a proposal without mutating the repository', async () => {
    const { root, service } = studio();
    await service.discover();
    const before = snapshot(root);
    for (const generator of DEFAULT_GENERATORS) {
      const proposal = await service.generate(generator.id, generator.id === 'studio-configuration' ? { values: { 'appearance.colors.primary': '#e11d2e' } } : {});
      expect(proposal.generator).toBe(generator.id);
      expect(['draft', 'ready-for-review']).toContain(proposal.status);
      for (const change of proposal.fileChanges) expect(change.path.startsWith('.gix/')).toBe(true);
    }
    expect(snapshot(root)).toEqual(before);
  });

  it('API → Tools: suggests risk, permission and approval, and disables destructive tools by default', async () => {
    const { service } = studio();
    const proposal = await service.generate('api-tools');
    const byName = Object.fromEntries(proposal.tools.map((tool) => [tool.name, tool]));
    expect(byName['applications.list']).toMatchObject({ risk: 'read-only', permission: 'APPLICATION_VIEW', approval: 'none', enabled: true, selected: true });
    expect(byName['applications.create']).toMatchObject({ risk: 'write', permission: 'APPLICATION_CREATE', approval: 'user-confirmation', enabled: true });
    expect(byName['appointments.delete']).toMatchObject({ risk: 'destructive', approval: 'admin', enabled: false, selected: false });
    expect(proposal.policies).toHaveLength(proposal.tools.length);
    const file = proposal.fileChanges.find((change) => change.path === '.gix/tools/routes.ts');
    expect(file?.content).toContain("name: \"applications.list\"");
    expect(file?.content).toContain('createFetchHttpExecutor');
    expect(proposal.fileChanges.map((change) => change.path)).toContain('.gix/security/routes.security.ts');
  });

  it('OpenAPI → Tools registers only reviewed operations through @gixcopilot/openapi', async () => {
    const { service } = studio();
    const generated = await service.generate('openapi-tools');
    expect(generated.tools.map((tool) => tool.name)).toEqual(['applications.list', 'applications.create', 'applications.get', 'applications.update', 'applications.delete']);
    // Unselected items produce no code at all; a selected-but-disabled tool is listed as not exposed.
    const remove = generated.tools.find((tool) => tool.name === 'applications.delete');
    expect(generated.fileChanges.find((change) => change.path.endsWith('.openapi.ts'))?.content).not.toContain('applications.delete');
    const proposal = await service.edit(generated.id, [{ collection: 'tools', id: remove?.id ?? '', changes: { selected: true } }]);
    const file = proposal.fileChanges.find((change) => change.path.endsWith('.openapi.ts'))?.content ?? '';
    expect(file).toContain('registerOpenAPI');
    expect(file).toContain('include: ["listApplications", "createApplication", "getApplication", "updateApplication"]');
    expect(file).not.toContain('"deleteApplication": {');
    expect(file).toContain('Disabled in review (not exposed): applications.delete');
  });

  it('context, UI, security, agents, skills and knowledge produce application-plane proposals', async () => {
    const { service } = studio();
    const context = await service.generate('state-context');
    expect(context.context.map((item) => item.name).sort()).toEqual(['currentUser', 'permissions', 'selectedApplication', 'tenant']);
    expect(context.fileChanges[0]?.content).toContain('registerApplicationContext');
    const ui = await service.generate('components-ui');
    expect(ui.ui.map((item) => item.name)).toEqual(['PaymentStatusCard']);
    expect(ui.fileChanges[0]?.content).toContain('status: z.enum(["paid", "pending", "failed"])');
    const security = await service.generate('auth-security');
    expect(security.policies.map((policy) => `${policy.tool}:${policy.requiredPermissions.join(',')}`).sort()).toEqual(['applications.create:APPLICATION_CREATE', 'applications.list:APPLICATION_VIEW']);
    const agents = await service.generate('project-agents');
    expect(agents.agents.map((agent) => agent.name)).toEqual(['application-assistant']);
    expect(agents.agents[0]?.tools).not.toContain('applications.delete');
    const skills = await service.generate('project-skills');
    expect(skills.skills.map((skill) => skill.name)).toEqual(['application-search', 'application-management']);
    const knowledge = await service.generate('docs-knowledge');
    expect(knowledge.knowledge.map((group) => group.name).sort()).toEqual(['Appointments Knowledge', 'Payments Knowledge', 'Project Knowledge']);
    expect(knowledge.knowledge.every((group) => !group.selected)).toBe(true);
    expect(knowledge.fileChanges).toHaveLength(0);
  });
});

describe('proposal review and approval (§47-52, §75)', () => {
  it('rejected: repository unchanged, proposal stays editable', async () => {
    const { root, service } = studio();
    const proposal = await service.generate('api-tools');
    const before = snapshot(root);
    expect(service.reject(proposal.id).status).toBe('rejected');
    expect(snapshot(root)).toEqual(before);
    const edited = await service.edit(proposal.id, [{ collection: 'tools', id: proposal.tools[0]?.id ?? '', changes: { description: 'Lists applications.' } }]);
    expect(edited.status).toBe('ready-for-review');
  });

  it('partial selection: only selected changes are applied', async () => {
    const { root, service } = studio();
    const proposal = await service.generate('api-tools');
    const keep = proposal.tools.filter((tool) => tool.operation.source === 'routes' && tool.risk === 'read-only');
    const approved = await service.approve(proposal.id, keep.map((tool) => tool.id));
    expect(approved.fileChanges.map((change) => change.path).sort()).toEqual(['.gix/security/routes.security.ts', '.gix/tools/routes.ts']);
    const applied = await service.apply(proposal.id);
    expect(applied.status).toBe('applied');
    expect(applied.applyResult?.outcome).toBe('complete');
    const written = readFileSync(join(root, '.gix/tools/routes.ts'), 'utf8');
    for (const tool of keep) expect(written).toContain(`"${tool.name}"`);
    expect(written).not.toContain('applications.create');
    expect(Object.keys(snapshot(root)).filter((path) => path.startsWith('.gix/'))).toHaveLength(2);
  });

  it('approval is required, and a proposal cannot be applied twice', async () => {
    const { service } = studio();
    const proposal = await service.generate('components-ui');
    await expect(service.apply(proposal.id)).rejects.toThrow(ApplyRefusedError);
    await service.approve(proposal.id);
    expect((await service.apply(proposal.id)).status).toBe('applied');
    await expect(service.apply(proposal.id)).rejects.toThrow(/already applied/);
    await expect(service.approve(proposal.id)).rejects.toThrow(ProposalStateError);
  });

  it('edits cannot bypass the security floor', async () => {
    const { service } = studio();
    const proposal = await service.generate('api-tools');
    const create = proposal.tools.find((tool) => tool.name === 'applications.create');
    const remove = proposal.tools.find((tool) => tool.name === 'appointments.delete');
    if (!create || !remove) throw new Error('fixture tools missing');
    const lowered = await service.edit(proposal.id, [{ collection: 'tools', id: create.id, changes: { approval: 'none' } }]);
    expect(lowered.status).toBe('draft');
    expect(lowered.securityReview.map((finding) => finding.code)).toContain('APPROVAL_BELOW_POLICY');
    await expect(service.approve(proposal.id)).rejects.toThrow(StudioApprovalError);
    await service.edit(proposal.id, [{ collection: 'tools', id: create.id, changes: { approval: 'user-confirmation' } }]);
    const exposed = await service.edit(proposal.id, [{ collection: 'tools', id: remove.id, changes: { selected: true, enabled: true, permission: null } }]);
    expect(exposed.securityReview.map((finding) => finding.code)).toContain('DESTRUCTIVE_WITHOUT_PERMISSION');
    const renamed = await service.edit(proposal.id, [{ collection: 'tools', id: remove.id, changes: { permission: 'APPOINTMENT_DELETE', name: 'repo.readFile' } }]);
    expect(renamed.securityReview.map((finding) => finding.code)).toContain('DEVELOPMENT_PLANE_NAME');
    await expect(service.edit(proposal.id, [{ collection: 'tools', id: remove.id, changes: { name: 'shell run' } }])).rejects.toThrow(/Invalid edit/);
    await expect(service.edit(proposal.id, [{ collection: 'tools', id: remove.id, changes: { content: 'x' } }])).rejects.toThrow(/Invalid edit/);
  });

  it('lowering a heuristic risk is allowed but called out in review', async () => {
    const { service } = studio();
    const proposal = await service.generate('api-tools');
    const create = proposal.tools.find((tool) => tool.name === 'applications.create');
    const edited = await service.edit(proposal.id, [{ collection: 'tools', id: create?.id ?? '', changes: { risk: 'read-only', approval: 'none' } }]);
    expect(edited.status).toBe('ready-for-review');
    expect(edited.securityReview.find((finding) => finding.code === 'RISK_LOWERED')?.severity).toBe('warning');
    expect(edited.policies.find((policy) => policy.tool === 'applications.create')).toMatchObject({ risk: 'read-only', approval: 'none' });
  });

  it('a secret in generated output blocks approval', async () => {
    const { service } = studio();
    const proposal = await service.generate('components-ui');
    const edited = await service.edit(proposal.id, [{ collection: 'ui', id: proposal.ui[0]?.id ?? '', changes: { description: 'key sk-proj-abcdefghijklmnopqrstuvwxyz0123456789' } }]);
    expect(edited.securityReview.map((finding) => finding.code)).toContain('SECRET_IN_OUTPUT');
    await expect(service.approve(proposal.id)).rejects.toThrow(StudioApprovalError);
  });

  it('shows a real diff for each file', async () => {
    const { service } = studio();
    const proposal = await service.generate('state-context');
    const view = await service.proposal(proposal.id);
    expect(view.diffs[0]?.diff).toMatch(/^--- \/dev\/null\n\+\+\+ b\/\.gix\/context\/application-context\.ts\n@@ -0,0 \+1,\d+ @@/);
  });
});

describe('apply engine (§53-60, §77)', () => {
  it('detects a conflict and never overwrites a file changed after generation', async () => {
    const { root, service } = studio();
    const proposal = await service.generate('components-ui');
    await service.approve(proposal.id);
    const target = join(root, '.gix/ui/generative-components.ts');
    mkdirSync(join(root, '.gix/ui'), { recursive: true });
    writeFileSync(target, '// my own edit\n');
    const result = await service.apply(proposal.id);
    expect(result.status).toBe('ready-for-review');
    expect(result.conflicts).toEqual([{ path: '.gix/ui/generative-components.ts', message: 'The file was created after this proposal was generated.' }]);
    expect(result.applyResult?.outcome).toBe('aborted');
    expect(readFileSync(target, 'utf8')).toBe('// my own edit\n');
  });

  it('reports APPLIED WITH VALIDATION ERRORS, never success, and can roll back', async () => {
    const { root, service } = studio(failingTests);
    await service.discover();
    const proposal = await service.generate('state-context');
    await service.approve(proposal.id);
    const result = await service.apply(proposal.id);
    expect(result.status).toBe('failed');
    expect(result.applyResult?.outcome).toBe('applied-with-validation-errors');
    expect(result.applyResult?.message).not.toContain('APPLY COMPLETE');
    const checks = Object.fromEntries((result.applyResult?.validation ?? []).map((check) => [check.name, check.status]));
    expect(checks).toMatchObject({ typecheck: 'passed', lint: 'passed', test: 'failed', security: 'passed', integration: 'passed' });
    expect(JSON.stringify(result.applyResult)).not.toContain('abcdefghijklmnop');
    expect(service.diagnostics().stage).toBe('validation-failed');
    const rollback = await service.rollback(proposal.id);
    expect(rollback.restored).toEqual(['.gix/context/application-context.ts']);
    expect(Object.keys(snapshot(root)).some((path) => path.startsWith('.gix/context'))).toBe(false);
  });

  it('skips validation steps the project has no script for, and uses the detected package manager', async () => {
    const seen: string[] = [];
    const { service } = studio((command) => {
      seen.push(`${command.command} ${command.args.join(' ')}`);
      return Promise.resolve({ exitCode: 0, output: '' });
    });
    await service.discover();
    const proposal = await service.generate('components-ui');
    await service.approve(proposal.id);
    await service.apply(proposal.id);
    expect(seen).toEqual(['pnpm run typecheck', 'pnpm run lint', 'pnpm run test']);
  });

  it('blocks path traversal even inside an approved proposal', async () => {
    const root = createFixture({ 'package.json': '{}' });
    roots.push(root);
    const engine = createApplyEngine({ guard: createWorkspaceGuard(root), commands: () => ({}), runner: passing });
    const forged = { id: 'x', status: 'approved', tools: [], context: [], ui: [], agents: [], skills: [], knowledge: [], policies: [], configChanges: [], fileChanges: [{ path: '.gix/../../escape.ts', kind: 'create', content: 'x', baseHash: null, itemIds: [] }] } as unknown as ChangeProposal;
    await expect(engine.apply(forged)).rejects.toThrow(WorkspaceViolationError);
    const outside = { ...forged, fileChanges: [{ path: 'src/index.ts', kind: 'create', content: 'x', baseHash: null, itemIds: [] }] } as unknown as ChangeProposal;
    await expect(engine.apply(outside)).rejects.toThrow(/Security review failed/);
  });
});

describe('diagnostics lifecycle (§26-29, §78)', () => {
  it('reflects every stage from before discovery to after apply', async () => {
    const { service } = studio();
    const pre = service.diagnostics();
    expect(pre.stage).toBe('pre-discovery');
    expect(pre.discovery.map((row) => [row.label, row.value])).toEqual([['Project Discovery', 'Not run'], ['API Discovery', 'Not run']]);
    expect(pre.runtime.find((row) => row.key === 'firewall')?.status).toBe('ok');
    await service.discover();
    const discovered = service.diagnostics();
    expect(discovered.stage).toBe('discovered');
    // 4 Fastify routes + 3 frontend calls + 5 OpenAPI operations.
    expect(discovered.discovery.find((row) => row.key === 'apis')?.value).toBe(12);
    expect(discovered.discovery.find((row) => row.key === 'components')?.value).toBe(4);
    const proposal = await service.generate('api-tools');
    const generated = service.diagnostics();
    expect(generated.stage).toBe('generated');
    expect(generated.generation.find((row) => row.key === 'tool-candidates')?.value).toBe(proposal.tools.length);
    await service.approve(proposal.id);
    expect(service.diagnostics().stage).toBe('approved');
    await service.apply(proposal.id);
    const applied = service.diagnostics();
    expect(applied.stage).toBe('applied');
    expect(applied.apply.find((row) => row.key === 'generated-tools')?.value).toBe(proposal.tools.filter((tool) => tool.selected && tool.enabled).length);
    expect(applied.apply.find((row) => row.key === 'validation-test')?.status).toBe('ok');
  });
});

describe('sync (§62)', () => {
  it('re-scans, compares and proposes; it never writes', async () => {
    const { root, service } = studio();
    await service.discover();
    const before = snapshot(root);
    writeFileSync(join(root, 'apps/api/src/invoices.ts'), "export async function invoices(app: any) { app.get('/invoices', async () => []); }\n");
    const result = await service.sync();
    expect(result.comparison?.newApis.map((operation) => operation.path)).toEqual(['/invoices']);
    expect(result.proposals.flatMap((proposal) => proposal.tools.map((tool) => tool.name))).toEqual(['invoices.list']);
    const after = snapshot(root);
    delete after['apps/api/src/invoices.ts'];
    expect(after).toEqual(before);
  });
});
