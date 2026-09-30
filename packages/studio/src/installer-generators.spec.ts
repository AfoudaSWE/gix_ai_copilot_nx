import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFixture, FULL_STACK_FIXTURE, PORTAL_FIXTURE, removeFixture, snapshot } from './fixtures.spec-helper.js';
import { patchViteConfig, routePattern } from './generators/app-integration.js';
import { safeSelection } from './proposals/safe.js';
import { createStudioService } from './service.js';
import type { StudioService } from './service.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeFixture(root);
});
function studio(files: Readonly<Record<string, string>>, persist = false): { root: string; service: StudioService } {
  const root = createFixture(files);
  roots.push(root);
  return { root, service: createStudioService({ root, persistProposals: persist, commandRunner: () => Promise.resolve({ exitCode: 0, output: '' }) }) };
}

const PORTAL_WITH_VITE = { ...PORTAL_FIXTURE, 'apps/portal/vite.config.ts': "import { defineConfig } from 'vite';\nexport default defineConfig({\n  plugins: [],\n});\n" };

describe('app integration: UI + page context (§11, §29-35)', () => {
  it('integrates only the frontend app, with page context and relevant tools', async () => {
    const { root, service } = studio(PORTAL_WITH_VITE);
    const before = snapshot(root);
    const proposal = await service.generate('app-integration');
    expect(snapshot(root)).toEqual(before);
    expect(proposal.integrations).toEqual([expect.objectContaining({ app: 'apps/portal', framework: 'react', selected: true, gixDir: 'apps/portal/src/gix', targets: ['apps/portal/src/main.tsx', 'apps/portal/vite.config.ts'] })]);
    const page = proposal.context.find((item) => item.page?.route === '/applications/:id');
    expect(page?.page).toMatchObject({ component: 'ApplicationDetails', params: ['id'], context: ['applicationId', 'currentApplication'], relevantTools: ['applications.get', 'applications.documents.list', 'payments.get'] });
    expect(proposal.fileChanges.map((change) => `${change.kind} ${change.path}`).sort()).toEqual([
      'create apps/portal/src/gix/GixCopilot.tsx',
      'create apps/portal/src/gix/page-context.ts',
      'modify apps/portal/src/main.tsx',
      'modify apps/portal/vite.config.ts',
    ]);
    const main = proposal.fileChanges.find((change) => change.path.endsWith('main.tsx'))?.content ?? '';
    expect(main).toContain("import { GixCopilot } from './gix/GixCopilot';");
    expect(main).toContain('.render(<><App /><GixCopilot /></>)');
    expect(proposal.fileChanges.find((change) => change.path.endsWith('vite.config.ts'))?.content).toContain("'/api/copilot': { target: 'http://127.0.0.1:4000'");
    // Editing existing app files is flagged in review; nothing is blocked.
    expect(proposal.status).toBe('ready-for-review');
    expect(proposal.securityReview.filter((finding) => finding.code === 'MODIFIES_APPLICATION_SOURCE').map((finding) => finding.path).sort()).toEqual(['apps/portal/src/main.tsx', 'apps/portal/vite.config.ts']);
  });

  it('writes a page-context resolver that maps routes to context and tools', async () => {
    const { root, service } = studio(PORTAL_WITH_VITE);
    const proposal = await service.approve((await service.generate('app-integration')).id);
    expect((await service.apply(proposal.id)).status).toBe('applied');
    const source = readFileSync(join(root, 'apps/portal/src/gix/page-context.ts'), 'utf8');
    expect(source).toContain('"pattern": "^/applications/([^/]+)/?$"'.replace(/"pattern": /, 'pattern: '));
    expect(source).toContain('export function describePageContext');
    expect(source).toContain('a hint, not a permission');
    expect(readFileSync(join(root, 'apps/portal/src/main.tsx'), 'utf8')).toContain('<GixCopilot />');
  });

  it('patches Vue App.vue; names a manual step when no dev proxy config exists', async () => {
    const { service } = studio(FULL_STACK_FIXTURE);
    const proposal = await service.generate('app-integration');
    expect(proposal.integrations).toEqual([expect.objectContaining({ app: 'client', framework: 'vue', selected: true })]);
    const app = proposal.fileChanges.find((change) => change.path === 'client/src/App.vue')?.content ?? '';
    expect(app).toMatch(/<script setup lang="ts">\nimport GixCopilot from '\.\/gix\/GixCopilot\.vue';/);
    expect(app).toContain('  <GixCopilot />\n</template>');
    expect(proposal.warnings.find((warning) => warning.code === 'MANUAL_STEP')?.message).toMatch(/Forward \/api\/copilot/);
  });

  it('patches an Angular root component, its template and the Nx proxy target', async () => {
    const { service } = studio({
      'package.json': JSON.stringify({ name: 'ng', dependencies: { '@angular/core': '^21.0.0' }, devDependencies: { nx: '21.0.0', typescript: '5.9.3' } }),
      'nx.json': '{}',
      'apps/admin/project.json': JSON.stringify({ name: 'admin', projectType: 'application', targets: { serve: { executor: '@angular/build:dev-server', options: {} } } }),
      'apps/admin/src/app/app.component.ts': "import { Component } from '@angular/core';\n@Component({ selector: 'app-root', imports: [], templateUrl: './app.component.html' })\nexport class AppComponent {}\n",
      'apps/admin/src/app/app.component.html': '<router-outlet />\n',
      'apps/admin/src/app/app.routes.ts': "import type { Routes } from '@angular/router';\nexport const routes: Routes = [{ path: 'users/:id', component: UserComponent }];\ndeclare const UserComponent: unknown;\n",
    });
    const proposal = await service.generate('app-integration');
    const byPath = Object.fromEntries(proposal.fileChanges.map((change) => [change.path, change.content ?? '']));
    expect(byPath['apps/admin/src/app/app.component.ts']).toContain("imports: [GixCopilotComponent, ]");
    expect(byPath['apps/admin/src/app/app.component.ts']).toContain("import { GixCopilotComponent } from './gix/gix-copilot.component';");
    expect(byPath['apps/admin/src/app/app.component.html']).toBe('<router-outlet />\n<gix-copilot />\n');
    expect(JSON.parse(byPath['apps/admin/project.json'] ?? '{}')).toMatchObject({ targets: { serve: { options: { proxyConfig: 'apps/admin/proxy.conf.json' } } } });
    expect(JSON.parse(byPath['apps/admin/proxy.conf.json'] ?? '{}')).toMatchObject({ '/api/copilot': { target: 'http://127.0.0.1:4000' } });
    expect(byPath['apps/admin/src/app/gix/gix-copilot.component.ts']).toContain("injectCopilotContext({ id: 'gix.page'");
  });

  it('lets the developer choose when several frontends exist (§52), and proposes nothing for a backend-only repo (§50)', async () => {
    const { service } = studio({
      'package.json': JSON.stringify({ name: 'multi', private: true, workspaces: ['apps/*'] }),
      'apps/customer-web/package.json': JSON.stringify({ name: 'customer-web', scripts: { dev: 'vite' }, dependencies: { react: '^19.0.0' } }),
      'apps/customer-web/src/main.tsx': "import { App } from './App';\nroot.render(<App />);\ndeclare const root: any;\n",
      'apps/admin-web/package.json': JSON.stringify({ name: 'admin-web', scripts: { dev: 'vite' }, dependencies: { react: '^19.0.0' } }),
      'apps/admin-web/src/main.tsx': "import { App } from './App';\nroot.render(<App />);\ndeclare const root: any;\n",
    });
    const proposal = await service.generate('app-integration');
    expect(proposal.integrations.map((integration) => `${integration.app}:${String(integration.selected)}`).sort()).toEqual(['apps/admin-web:false', 'apps/customer-web:false']);
    expect(proposal.warnings.map((warning) => warning.code)).toContain('CHOOSE_APPS');
    const chosen = await service.generate('app-integration', { select: ['apps/customer-web'] });
    expect(chosen.integrations.map((integration) => `${integration.app}:${String(integration.selected)}`)).toEqual(['apps/customer-web:true']);

    const backend = studio({ 'package.json': JSON.stringify({ name: 'api', scripts: { start: 'node index.js' }, dependencies: { fastify: '^5.0.0' } }), 'index.js': "app.get('/users', handler);\n" }).service;
    const none = await backend.generate('app-integration');
    expect(none.integrations).toEqual([]);
    expect(none.context).toEqual([]);
    expect(none.warnings.map((warning) => warning.code)).toEqual(['NO_FRONTEND']);
  });

  it('never writes outside .gix/ and the declared integration files', async () => {
    const { service } = studio(PORTAL_WITH_VITE);
    const proposal = await service.generate('app-integration');
    const generator = (await import('./generators/app-integration.js')).appIntegrationGenerator;
    expect(generator.allowedPaths?.('apps/portal/src/App.tsx', proposal)).toBe(false);
    expect(generator.allowedPaths?.('apps/api/src/routes.ts', proposal)).toBe(false);
    expect(generator.allowedPaths?.('package.json', proposal)).toBe(false);
  });

  it('builds route patterns and leaves a Vite config with its own server section alone', () => {
    expect(routePattern('/applications/:id')).toBe('^/applications/([^/]+)/?$');
    expect(routePattern('/orders/{id}/items')).toBe('^/orders/([^/]+)/items/?$');
    expect(routePattern('/')).toBe('^/?$');
    expect(patchViteConfig("export default defineConfig({ server: { port: 3000 } });")).toBeUndefined();
  });
});

describe('Approve Safe Changes (§44)', () => {
  it('selects read-only, known-contract tools and never destructive, write or conflicted ones', async () => {
    const { service } = studio(PORTAL_FIXTURE);
    const proposal = await service.generate('openapi-tools');
    const selection = new Set(safeSelection(proposal));
    const selectedNames = proposal.tools.filter((tool) => selection.has(tool.id)).map((tool) => tool.name).sort();
    expect(selectedNames).toEqual(['applications.documents.list', 'applications.get', 'applications.list']);
    const approved = await service.approveSafe(proposal.id);
    expect(approved.tools.filter((tool) => tool.selected).map((tool) => tool.name).sort()).toEqual(selectedNames);
    // PATCH /applications/{id} is conflicted (OpenAPI vs Postman): proposed, unselected, flagged.
    const update = proposal.tools.find((tool) => tool.name === 'applications.update');
    expect(update).toMatchObject({ confidence: 'review', selected: false });
    expect(proposal.warnings.find((warning) => warning.itemId === update?.id && warning.code === 'NEEDS_REVIEW')?.message).toMatch(/Request fields differ/);
  });
});

describe('persisted proposals (§57-60)', () => {
  it('keeps proposals but requires fresh approval across Studio restarts', async () => {
    const { root, service } = studio(PORTAL_FIXTURE, true);
    const proposal = await service.generate('components-ui');
    await service.approve(proposal.id);
    const restarted = createStudioService({ root, persistProposals: true });
    expect(restarted.proposals().map((entry) => `${entry.id}:${entry.status}`)).toEqual([`${proposal.id}:ready-for-review`]);
    await expect(restarted.apply(proposal.id)).rejects.toThrow(/approved/i);
    await restarted.approve(proposal.id);
    expect((await restarted.apply(proposal.id)).status).toBe('applied');
    expect(readFileSync(join(root, '.gix/proposals', `${proposal.id}.json`), 'utf8')).not.toContain('OPENAI_API_KEY');
  });
});
