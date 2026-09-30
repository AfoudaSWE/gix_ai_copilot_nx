import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzePages } from './discovery/pages.js';
import { createFixture, removeFixture } from './fixtures.spec-helper.js';
import { appIntegrationGenerator } from './generators/app-integration.js';
import { createStudioService } from './service.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeFixture(root); });

function studio(next = false) {
  const files: Record<string, string> = { 'package.json': JSON.stringify({ private: true, workspaces: ['apps/*'], devDependencies: { typescript: '5.9.3' } }) };
  for (const app of ['admin', 'portal']) {
    files[`apps/${app}/package.json`] = JSON.stringify({ name: app, scripts: { dev: next ? 'next dev' : 'vite' }, dependencies: next ? { next: '16.0.0', react: '19.0.0' } : { react: '19.0.0' } });
    files[`apps/${app}/src/main.tsx`] = 'root.render(<App />);';
    files[`apps/${app}/src/app/layout.tsx`] = 'export default function Layout({ children }) { return <html><body>{children}</body></html>; }';
    files[`apps/${app}/src/routes.tsx`] = "import { Details } from './Details';\nexport const routes = <Route path='/items/:id' element={<Details />} />;";
    files[`apps/${app}/src/Details.tsx`] = `export function Details() { fetch('/${app}'); return <div />; }`;
  }
  const root = createFixture(files);
  roots.push(root);
  return createStudioService({ root });
}

describe('app integration regressions', () => {
  it.each([
    "export default defineConfig({ server: { port: 5173 } });",
    'export default buildConfig();',
  ])('reports a nonblocking manual step for an unsafe Vite proxy patch: %s', async (config) => {
    const root = createFixture({
      'package.json': JSON.stringify({ name: 'web', dependencies: { react: '19.0.0' }, devDependencies: { typescript: '5.9.3' } }),
      'src/main.tsx': 'root.render(<App />);',
      'vite.config.ts': config,
    });
    roots.push(root);
    const service = createStudioService({ root });
    const proposal = await service.generate('app-integration');
    expect(proposal.status).toBe('ready-for-review');
    expect(proposal.fileChanges.some((file) => file.path === 'vite.config.ts')).toBe(false);
    expect(await service.workspace.readText('vite.config.ts')).toBe(config);
    const warning = proposal.warnings.find((item) => item.code === 'MANUAL_STEP');
    expect(warning?.message).toContain('Could not safely patch vite.config.ts; it was left unchanged.');
    expect(warning?.message).toContain('server.proxy');
    expect(warning?.message).toContain('forward /api/copilot/* to http://127.0.0.1:4000/*');
    expect(warning?.message).toContain('strip the /api/copilot prefix');
    expect(warning?.itemId).toBe(proposal.integrations[0]?.id);
    expect((await service.approve(proposal.id)).status).toBe('approved');
  });

  it.each([false, true])('renders React/Next without browser globals (Next: %s)', async (next) => {
    const proposal = await studio(next).generate('app-integration', { select: ['apps/portal'] });
    const source = proposal.fileChanges.find((file) => file.path.endsWith('/GixCopilot.tsx'))?.content;
    expect(source).toBeDefined();
    const code = ts.transpileModule(source ?? '', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const contexts: { id: string; enabled?: boolean; value: unknown }[] = [];
    // Execute the emitted component and its child render, without running client effects.
    const exports: { GixCopilot?: () => unknown } = {};
    runInNewContext(code, { exports, require: (name: string): unknown => {
      if (name === 'react') return { useState: (initial: unknown) => [initial, () => undefined], useEffect: () => undefined };
      const render = (component: unknown, props: unknown): unknown => typeof component === 'function' ? (component as (props: unknown) => unknown)(props) : null;
      if (name === 'react/jsx-runtime') return { jsx: render, jsxs: render };
      if (name === '@gixcopilot/react') return { CopilotProvider: () => null, useCopilotContext: (context: { id: string; value: unknown }) => contexts.push(context) };
      if (name === '@gixcopilot/ui') return { CopilotPopup: () => null };
      if (name === './page-context') return { describePageContext: (path: string) => path, watchPathname: () => { throw new Error('Effect ran during SSR'); } };
      return {};
    } });
    expect(() => exports.GixCopilot?.()).not.toThrow();
    expect(contexts.filter((context) => ['gix.page', 'gix.locale'].includes(context.id))).toEqual([
      expect.objectContaining({ id: 'gix.page', enabled: false }),
      expect.objectContaining({ id: 'gix.locale', enabled: false }),
    ]);
  });

  it('keeps identical URLs and component names separate by route source', () => {
    const pages = analyzePages({
      routes: ['admin', 'portal'].map((app) => ({ path: '/items/:id', kind: 'frontend', file: `apps/${app}/src/routes.tsx`, component: 'Details' })),
      components: ['admin', 'portal'].map((app) => ({ name: 'Details', framework: 'react', file: `apps/${app}/src/Details.tsx`, props: [], candidate: false, reason: 'Page' })), operations: [], contextCandidates: [],
      facts: new Map(['admin', 'portal'].flatMap((app) => [
        [`apps/${app}/src/routes.tsx`, { calls: [], imports: { Details: './Details' }, importedNames: {} }],
        [`apps/${app}/src/Details.tsx`, { calls: [], imports: {}, importedNames: {} }],
      ])),
    });
    expect(pages.map((page) => page.file).sort()).toEqual(['apps/admin/src/Details.tsx', 'apps/portal/src/Details.tsx']);
  });

  it('emits nothing for unselected apps even when their context is selected', async () => {
    const service = studio();
    const proposal = await service.generate('app-integration');
    expect(proposal.context.some((item) => item.selected)).toBe(true);
    expect(proposal.fileChanges).toEqual([]);
    const selected = await service.edit(proposal.id, [{ collection: 'integrations', id: 'integration:apps/portal', changes: { selected: true } }]);
    expect(selected.fileChanges.every((file) => file.path.startsWith('apps/portal/'))).toBe(true);
    expect(selected.context.filter((item) => item.app === 'apps/portal' && item.page).map((item) => item.source.file)).toEqual(['apps/portal/src/Details.tsx']);
    const deselected = await service.edit(proposal.id, [{ collection: 'integrations', id: 'integration:apps/portal', changes: { selected: false } }]);
    expect(deselected.fileChanges).toEqual([]);
    expect(appIntegrationGenerator.allowedPaths?.('apps/portal/src/gix/page-context.ts', deselected)).toBe(false);
  });

  it('rejects self-declared targets and directories against independent discovery', async () => {
    const service = studio();
    const proposal = await service.generate('app-integration', { select: ['apps/portal'] });
    for (const changes of [
      { targets: ['apps/admin/src/main.tsx'] },
      { targets: ['apps/portal/src/Details.tsx'] },
      { gixDir: 'apps/admin/src/gix' },
      { app: 'missing', gixDir: 'missing/src/gix' },
    ]) {
      const integrations = proposal.integrations.map((integration) => ({ ...integration, ...changes }));
      const forged = { ...proposal, integrations };
      expect(appIntegrationGenerator.allowedPaths?.('apps/admin/src/main.tsx', forged)).toBe(false);
      await expect(appIntegrationGenerator.render(forged, { workspace: service.workspace })).rejects.toThrow(/Untrusted integration/);
    }
    expect(appIntegrationGenerator.allowedPaths?.('apps/portal/src/main.tsx', proposal)).toBe(true);
    expect(appIntegrationGenerator.allowedPaths?.('apps/portal/src/gix/arbitrary.ts', proposal)).toBe(false);
  });

  it('patches only the selected project in a shared Angular workspace', async () => {
    const projects = Object.fromEntries(['admin', 'portal'].map((app) => [app, { root: `apps/${app}`, projectType: 'application', architect: { serve: { options: {} } } }]));
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ private: true, workspaces: ['apps/*'], devDependencies: { typescript: '5.9.3' } }),
      'angular.json': JSON.stringify({ projects }),
    };
    for (const app of ['admin', 'portal']) {
      files[`apps/${app}/package.json`] = JSON.stringify({ name: app, scripts: { start: 'ng serve' }, dependencies: { '@angular/core': '21.0.0' } });
      files[`apps/${app}/src/app/app.component.ts`] = "@Component({ imports: [], templateUrl: './app.component.html' }) export class AppComponent {}";
      files[`apps/${app}/src/app/app.component.html`] = '<router-outlet />';
    }
    const root = createFixture(files);
    roots.push(root);
    const proposal = await createStudioService({ root }).generate('app-integration', { select: ['apps/portal'] });
    const content = proposal.fileChanges.find((file) => file.path === 'angular.json')?.content;
    expect(JSON.parse(content ?? '{}')).toEqual({ projects: {
      admin: projects['admin'],
      portal: { ...projects['portal'], architect: { serve: { options: { proxyConfig: 'apps/portal/proxy.conf.json' } } } },
    } });
    expect(proposal.fileChanges.some((file) => file.path.startsWith('apps/admin/'))).toBe(false);
  });
});
