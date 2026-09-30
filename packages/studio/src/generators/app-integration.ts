import { classifyProject } from '../discovery/classify.js';
import { discoverProject } from '../discovery/discover.js';
import type { ClassifiedApplication } from '../discovery/classify.js';
import type { ContextCandidateKind, DiscoveredProject, NormalizedApiOperation, PageInfo } from '../discovery/model.js';
import type { ContextProposal, IntegrationProposal, ProposalItems, ProposalWarning } from '../proposals/model.js';
import type { ReadonlyWorkspace } from '../workspace/workspace.js';
import { str } from './codegen.js';
import type { Generator, GeneratorContext, GeneratorInput, RenderedFile } from './contract.js';
import { EMPTY_DRAFT } from './draft.js';
import { toolNameFor } from './risk.js';

/** Where the browser reaches the copilot, and where the dev proxy forwards it (the GIX server). */
export const COPILOT_API_PREFIX = '/api/copilot';
export const COPILOT_SERVER_URL = 'http://127.0.0.1:4000';

type UiFramework = IntegrationProposal['framework'];

interface AppPlan {
  readonly app: ClassifiedApplication & { readonly ui: UiFramework };
  readonly gixDir: string;
  readonly typescript: boolean;
  readonly entry?: string;
  readonly markup?: string;
  readonly proxyConfig?: string;
  readonly angularWorkspace?: string;
  readonly pages: readonly PageInfo[];
}

interface IntegrationAnalysis {
  readonly plans: readonly AppPlan[];
  readonly globals: readonly { readonly name: string; readonly kind: ContextCandidateKind; readonly file: string; readonly line?: number }[];
  readonly operations: readonly NormalizedApiOperation[];
  readonly multiple: boolean;
}

const prefixOf = (app: string): string => (app === '.' || app === '' ? '' : `${app}/`);

// Authority is attached only to objects checked against this workspace, never serialized targets.
const trustedPaths = new WeakMap<IntegrationProposal, ReadonlySet<string>>();

/** A route as a regular-expression source: `/applications/:id` → `^/applications/([^/]+)/?$`. */
export function routePattern(route: string): string {
  const body = route
    .split('/')
    .map((segment) => (segment.startsWith(':') || /^\{.+\}$/.test(segment) ? '([^/]+)' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return `^${body === '' ? '/' : body.replace(/\/$/, '')}/?$`;
}

async function firstExisting(workspace: ReadonlyWorkspace, candidates: readonly string[]): Promise<string | undefined> {
  for (const candidate of candidates) if (await workspace.exists(candidate)) return candidate;
  return undefined;
}

async function planApp(workspace: ReadonlyWorkspace, app: ClassifiedApplication & { readonly ui: UiFramework }, discovery: DiscoveredProject): Promise<AppPlan> {
  const dir = prefixOf(app.path);
  const hasSrc = await workspace.exists(`${dir}src`);
  const typescript = discovery.workspace.language === 'typescript';
  const ext = typescript ? 'ts' : 'js';
  const x = typescript ? 'tsx' : 'jsx';
  const pages = discovery.pages.filter((page) => {
    const file = 'routeFile' in page && typeof page.routeFile === 'string' ? page.routeFile : page.file;
    if (!file) return false;
    const owner = discovery.applications.filter((candidate) => candidate.path === '.' || file.startsWith(prefixOf(candidate.path))).sort((a, b) => b.path.length - a.path.length)[0];
    return owner?.path === app.path;
  });
  switch (app.ui) {
    case 'react':
      return { app, typescript, pages, gixDir: `${dir}src/gix`, ...optional('entry', await firstExisting(workspace, [`${dir}src/main.${x}`, `${dir}src/index.${x}`, `${dir}src/main.tsx`, `${dir}src/main.jsx`])), ...optional('proxyConfig', await firstExisting(workspace, ['ts', 'mts', 'js', 'mjs'].map((extension) => `${dir}vite.config.${extension}`))) };
    case 'nextjs':
      return { app, typescript, pages, gixDir: `${dir}${hasSrc ? 'src/' : ''}gix`, ...optional('entry', await firstExisting(workspace, [`${dir}app/layout.${x}`, `${dir}src/app/layout.${x}`, `${dir}app/layout.tsx`, `${dir}src/app/layout.tsx`])) };
    case 'vue':
      return { app, typescript, pages, gixDir: `${dir}src/gix`, ...optional('entry', await firstExisting(workspace, [`${dir}src/App.vue`])), ...optional('proxyConfig', await firstExisting(workspace, ['ts', 'mts', 'js', 'mjs'].map((extension) => `${dir}vite.config.${extension}`))) };
    case 'angular': {
      const entry = await firstExisting(workspace, [`${dir}src/app/app.component.${ext}`, `${dir}src/app/app.${ext}`]);
      const markup = entry ? await firstExisting(workspace, [entry.replace(/\.(ts|js)$/, '.html')]) : undefined;
      const angularWorkspace = await firstExisting(workspace, [`${dir}project.json`, 'angular.json']);
      return { app, typescript, pages, gixDir: `${dir}src/app/gix`, ...optional('entry', entry), ...optional('markup', markup), ...optional('angularWorkspace', angularWorkspace) };
    }
  }
}

function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value ? ({ [key]: value } as Record<K, string>) : {};
}

const relative = (from: string, to: string): string => {
  const a = from.split('/').slice(0, -1);
  const b = to.split('/');
  while (a.length > 0 && b.length > 0 && a[0] === b[0]) {
    a.shift();
    b.shift();
  }
  const path = [...a.map(() => '..'), ...b].join('/');
  return path.startsWith('.') ? path : `./${path}`;
};

// --- Generated source ---------------------------------------------------------------------

function pageContextSource(ts: boolean, globals: readonly string[], pages: readonly ContextProposal[]): string {
  const t = (annotation: string): string => (ts ? annotation : '');
  const definitions = pages.map((item) => {
    const page = item.page;
    if (!page) return '';
    const paramNames = Object.fromEntries(page.params.map((param, index) => [param, page.context[index] ?? param]));
    return `  { route: ${str(page.route)}, pattern: ${str(routePattern(page.route))}, ${page.component ? `page: ${str(page.component)}, ` : ''}params: ${JSON.stringify(paramNames)}, context: ${JSON.stringify(page.context)}, relevantTools: ${JSON.stringify(page.relevantTools)} },`;
  });
  return `// Generated by GIX Developer Studio (App integration). Regenerating shows a diff first.
// Page context tells the copilot where the user is. Relevant tools are a hint for the model,
// never a permission: every tool call still passes the Action Firewall.
${ts ? `export interface PageContextDefinition {
  readonly route: string;
  readonly pattern: string;
  readonly page?: string;
  /** Route parameter → the context name it provides, e.g. id → applicationId. */
  readonly params: Readonly<Record<string, string>>;
  readonly context: readonly string[];
  readonly relevantTools: readonly string[];
}

export interface ResolvedPageContext extends PageContextDefinition {
  readonly pathname: string;
  readonly values: Readonly<Record<string, string>>;
}

` : ''}/** Global context names the copilot may see on every page; your app supplies the values. */
export const globalContextNames = ${JSON.stringify(globals)}${ts ? ' as const' : ''};

export const pageContexts${t(': readonly PageContextDefinition[]')} = [
${definitions.filter(Boolean).join('\n')}
];

export function resolvePageContext(pathname${t(': string')})${t(': ResolvedPageContext | undefined')} {
  for (const page of pageContexts) {
    const match = new RegExp(page.pattern).exec(pathname);
    if (!match) continue;
    const values${t(': Record<string, string>')} = {};
    Object.values(page.params).forEach((name, index) => {
      const value = match[index + 1];
      if (value !== undefined) values[name] = decodeURIComponent(value);
    });
    return { ...page, pathname, values };
  }
  return undefined;
}

/** Plain text for the model: where the user is, and which tools matter here. */
export function describePageContext(pathname${t(': string')})${t(': string')} {
  const page = resolvePageContext(pathname);
  if (!page) return \`Current path: \${pathname}\`;
  const lines = [\`Current page: \${page.page ?? page.route} (\${pathname})\`];
  for (const [name, value] of Object.entries(page.values)) lines.push(\`\${name}: \${value}\`);
  if (page.relevantTools.length > 0) lines.push(\`Tools relevant on this page (a hint, not a permission): \${page.relevantTools.join(', ')}\`);
  return lines.join('\\n');
}

/** Calls onChange with the current pathname on every client-side navigation. */
export function watchPathname(onChange${t(': (pathname: string) => void')})${t(': () => void')} {
  const notify = ()${t(': void')} => onChange(window.location.pathname);
  const wrap = (name${t(": 'pushState' | 'replaceState'")}) => {
    const original = history[name];
    history[name] = function (${t('this: History, ')}...args${t(': Parameters<History["pushState"]>')}) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event('gix:navigate'));
      return result;
    };
    return () => { history[name] = original; };
  };
  const restore = [wrap('pushState'), wrap('replaceState')];
  window.addEventListener('popstate', notify);
  window.addEventListener('gix:navigate', notify);
  notify();
  return () => {
    window.removeEventListener('popstate', notify);
    window.removeEventListener('gix:navigate', notify);
    restore.forEach((undo) => undo());
  };
}
`;
}

function componentSource(plan: IntegrationProposal): { readonly path: string; readonly content: string } {
  const ts = plan.typescript;
  switch (plan.framework) {
    case 'react':
    case 'nextjs':
      return {
        path: `${plan.gixDir}/GixCopilot.${ts ? 'tsx' : 'jsx'}`,
        content: `${plan.framework === 'nextjs' ? "'use client';\n\n" : ''}// Generated by GIX Developer Studio (App integration).
import { useEffect, useState } from 'react';
${ts ? "import type { ReactElement } from 'react';\n" : ''}import { CopilotProvider, useCopilotContext } from '@gixcopilot/react';
import { CopilotPopup } from '@gixcopilot/ui';
import '@gixcopilot/ui/styles.css';
import { describePageContext, watchPathname } from './page-context';

${ts ? `export interface GixCopilotProps {
  /** Global context (§35): pass what the model may know about the signed-in user. */
  readonly user?: unknown;
  readonly tenant?: string;
  readonly permissions?: readonly string[];
}

` : ''}function PageContext(${ts ? '{ user, tenant, permissions }: GixCopilotProps' : '{ user, tenant, permissions }'})${ts ? ': null' : ''} {
  const [pathname, setPathname] = useState('');
  const [locale, setLocale] = useState('');
  useEffect(() => {
    setLocale(navigator.language);
    return watchPathname(setPathname);
  }, []);
  useCopilotContext({ id: 'gix.page', name: 'Current page', scope: 'page', value: describePageContext(pathname), enabled: pathname !== '' });
  useCopilotContext({ id: 'gix.locale', name: 'Locale', scope: 'application', value: locale, enabled: locale !== '' });
  useCopilotContext({ id: 'gix.user', name: 'Current user', scope: 'user', sensitivity: 'sensitive', value: user ?? null, enabled: user !== undefined });
  useCopilotContext({ id: 'gix.tenant', name: 'Tenant', scope: 'application', value: tenant ?? null, enabled: tenant !== undefined });
  useCopilotContext({ id: 'gix.permissions', name: 'Permissions', scope: 'user', value: permissions ?? [], enabled: permissions !== undefined });
  return null;
}

/** The copilot chat for this app. The browser only calls ${COPILOT_API_PREFIX}; model keys stay on the server. */
export function GixCopilot(props${ts ? ': GixCopilotProps' : ''} = {})${ts ? ': ReactElement' : ''} {
  return (
    <CopilotProvider runtimeUrl="${COPILOT_API_PREFIX}">
      <PageContext {...props} />
      <CopilotPopup title="Copilot" />
    </CopilotProvider>
  );
}
`,
      };
    case 'vue':
      return {
        path: `${plan.gixDir}/GixCopilot.vue`,
        content: `<script setup${ts ? ' lang="ts"' : ''}>
// Generated by GIX Developer Studio (App integration).
import { onUnmounted, ref } from 'vue';
import { CopilotChat, provideCopilot, useCopilotContext } from '@gixcopilot/vue';
import '@gixcopilot/vue/styles.css';
import { describePageContext, watchPathname } from './page-context';

// The browser only calls ${COPILOT_API_PREFIX}; model keys stay on the server.
provideCopilot({ endpoint: '${COPILOT_API_PREFIX}' });
const pathname = ref(window.location.pathname);
onUnmounted(watchPathname((next) => { pathname.value = next; }));
useCopilotContext({ id: 'gix.page', name: 'Current page', scope: 'page', value: () => describePageContext(pathname.value) });
useCopilotContext({ id: 'gix.locale', name: 'Locale', scope: 'application', value: navigator.language });
</script>

<template>
  <CopilotChat label="Copilot" />
</template>
`,
      };
    case 'angular':
      return {
        path: `${plan.gixDir}/gix-copilot.component.ts`,
        content: `// Generated by GIX Developer Studio (App integration).
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CopilotChatComponent, injectCopilotContext, provideCopilot } from '@gixcopilot/angular';
import { describePageContext, watchPathname } from './page-context';

/** The copilot chat for this app. The browser only calls ${COPILOT_API_PREFIX}; model keys stay on the server. */
@Component({
  selector: 'gix-copilot',
  imports: [CopilotChatComponent],
  providers: [provideCopilot({ endpoint: '${COPILOT_API_PREFIX}' })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<aicopilot-chat label="Copilot" />',
})
export class GixCopilotComponent {
  private readonly pathname = signal(window.location.pathname);

  constructor() {
    inject(DestroyRef).onDestroy(watchPathname((next) => this.pathname.set(next)));
    injectCopilotContext({ id: 'gix.page', name: 'Current page', scope: 'page', value: computed(() => describePageContext(this.pathname())) });
    injectCopilotContext({ id: 'gix.locale', name: 'Locale', scope: 'application', value: navigator.language });
  }
}
`,
      };
  }
}

/** Adds the dev proxy to a Vite config's `defineConfig({ ... })` without an existing `server`. */
export function patchViteConfig(source: string): string | undefined {
  if (source.includes(COPILOT_API_PREFIX) || /\bserver\s*:/.test(source)) return undefined;
  const match = /defineConfig\(\s*\{/.exec(source);
  if (!match) return undefined;
  const at = match.index + match[0].length;
  return `${source.slice(0, at)}\n  // Added by GIX: the browser calls ${COPILOT_API_PREFIX}, the GIX copilot server answers.\n  server: { proxy: { '${COPILOT_API_PREFIX}': { target: '${COPILOT_SERVER_URL}', rewrite: (path) => path.replace(/^\\/api\\/copilot/, '') } } },${source.slice(at)}`;
}

function addImport(source: string, line: string): string {
  const imports = [...source.matchAll(/^import .*;\s*$/gm)];
  const last = imports.at(-1);
  if (!last) return `${line}\n${source}`;
  const at = (last.index ?? 0) + last[0].length;
  return `${source.slice(0, at)}\n${line}${source.slice(at)}`;
}

/** Applies one root edit; `undefined` means "no safe edit point", so a manual step is shown. */
function patchEntry(framework: UiFramework, source: string, importLine: string): string | undefined {
  switch (framework) {
    case 'react': {
      if (source.includes('<GixCopilot')) return undefined;
      const match = /<App\s*\/>/.exec(source);
      if (!match) return undefined;
      return addImport(source.slice(0, match.index) + '<><App /><GixCopilot /></>' + source.slice(match.index + match[0].length), importLine);
    }
    case 'nextjs': {
      if (source.includes('<GixCopilot')) return undefined;
      const at = source.indexOf('{children}');
      if (at < 0) return undefined;
      return addImport(`${source.slice(0, at)}{children}\n        <GixCopilot />${source.slice(at + '{children}'.length)}`, importLine);
    }
    case 'vue': {
      if (source.includes('<GixCopilot')) return undefined;
      const script = /<script\s+setup[^>]*>/.exec(source);
      const closing = source.lastIndexOf('</template>');
      if (!script || closing < 0) return undefined;
      const withTemplate = `${source.slice(0, closing)}  <GixCopilot />\n${source.slice(closing)}`;
      const at = script.index + script[0].length;
      return `${withTemplate.slice(0, at)}\n${importLine}${withTemplate.slice(at)}`;
    }
    case 'angular': {
      if (source.includes('GixCopilotComponent')) return undefined;
      if (!/imports\s*:\s*\[/.test(source)) return undefined;
      return addImport(source.replace(/imports\s*:\s*\[/, 'imports: [GixCopilotComponent, '), importLine);
    }
  }
}

function patchAngularProxy(source: string, proxyPath: string, nx: boolean, app: string): string | undefined {
  try {
    const json = JSON.parse(source) as Record<string, unknown>;
    const apply = (targets: Record<string, { options?: Record<string, unknown> }> | undefined): boolean => {
      const serve = targets?.['serve'];
      if (!serve || serve.options?.['proxyConfig']) return false;
      serve.options = { ...serve.options, proxyConfig: proxyPath };
      return true;
    };
    let changed = false;
    if (nx) changed = apply(json['targets'] as Record<string, { options?: Record<string, unknown> }> | undefined);
    else {
      for (const project of Object.values((json['projects'] ?? {}) as Record<string, { root?: string; projectType?: string; architect?: Record<string, { options?: Record<string, unknown> }> }>)) {
        const root = project.root === '' ? '.' : project.root;
        if (project.projectType === 'application' && root === app && apply(project.architect)) changed = true;
      }
    }
    return changed ? `${JSON.stringify(json, null, 2)}\n` : undefined;
  } catch {
    return undefined;
  }
}

// --- Generator ----------------------------------------------------------------------------

/**
 * App integration (§11, §29-35): for each frontend app, the framework's own copilot component,
 * global and page context, one edit at a high-level integration point (entry, layout, root
 * component or App.vue) and the dev proxy. Edits outside the app's `gix/` folder are limited to
 * the files named in the proposal and are always flagged in review.
 */
export const appIntegrationGenerator: Generator<IntegrationAnalysis> = {
  id: 'app-integration',
  title: 'App integration (UI + page context)',
  description: 'Adds the copilot chat to your frontend apps with global and per-page context, and points their dev proxy at the GIX server.',
  async analyze(context: GeneratorContext, input: GeneratorInput) {
    const classified = classifyProject(context.discovery);
    const frontends = classified.frontends.filter((app): app is ClassifiedApplication & { ui: UiFramework } => app.ui !== undefined);
    const chosen = input.select && input.select.length > 0 ? frontends.filter((app) => input.select?.includes(app.path) || input.select?.includes(app.name)) : frontends;
    const plans: AppPlan[] = [];
    for (const app of chosen) plans.push(await planApp(context.workspace, app, context.discovery));
    const seenKinds = new Set<ContextCandidateKind>();
    const globals = context.discovery.contextCandidates.filter((candidate) => ['user', 'tenant', 'permissions'].includes(candidate.kind) && !seenKinds.has(candidate.kind) && (seenKinds.add(candidate.kind), true));
    return { plans, globals, operations: context.discovery.operations, multiple: frontends.length > 1 && (!input.select || input.select.length === 0) };
  },
  async generate(analysis, { workspace }) {
    const warnings: ProposalWarning[] = [];
    const toolFor = new Map(analysis.operations.map((operation) => [operation.key, toolNameFor(operation.method, operation.path)]));
    const integrations: IntegrationProposal[] = [];
    const context: ContextProposal[] = [];
    for (const plan of analysis.plans) {
      const manual: string[] = [];
      if (!plan.entry) manual.push(`Render the copilot yourself: no ${plan.app.ui === 'angular' ? 'root component' : plan.app.ui === 'nextjs' ? 'app/layout' : plan.app.ui === 'vue' ? 'src/App.vue' : 'src/main entry'} was found.`);
      if (plan.app.ui === 'nextjs') manual.push(`Proxy ${COPILOT_API_PREFIX} to ${COPILOT_SERVER_URL} in next.config: async rewrites() { return [{ source: '${COPILOT_API_PREFIX}/:path*', destination: '${COPILOT_SERVER_URL}/:path*' }]; }`);
      if ((plan.app.ui === 'react' || plan.app.ui === 'vue') && !plan.proxyConfig) manual.push(`Forward ${COPILOT_API_PREFIX}/* to ${COPILOT_SERVER_URL}/* in your dev server.`);
      if (plan.proxyConfig) {
        const source = await workspace.readText(plan.proxyConfig);
        if (source === undefined || patchViteConfig(source) === undefined) {
          manual.push(`Could not safely patch ${plan.proxyConfig}; it was left unchanged. Configure or verify server.proxy there: forward ${COPILOT_API_PREFIX}/* to ${COPILOT_SERVER_URL}/* and strip the ${COPILOT_API_PREFIX} prefix from the forwarded path.`);
        }
      }
      const id = `integration:${plan.app.path}`;
      integrations.push({
        id,
        // With several frontends the developer chooses which ones get the copilot (§52).
        selected: !analysis.multiple,
        kind: 'ui',
        app: plan.app.path,
        framework: plan.app.ui,
        description: `${plan.app.ui} chat + page context in ${plan.app.path === '.' ? 'the root app' : plan.app.path}`,
        gixDir: plan.gixDir,
        typescript: plan.typescript,
        targets: [plan.entry, plan.markup, plan.proxyConfig, plan.angularWorkspace].filter((value): value is string => value !== undefined),
        manual,
      });
      for (const global of analysis.globals) {
        context.push({ id: `global:${plan.app.path}:${global.name}`, selected: true, name: global.name, kind: global.kind, description: `Global ${global.kind} context (found in ${global.file}).`, sensitivity: global.kind === 'user' ? 'sensitive' : 'internal', source: { file: global.file, ...(global.line ? { line: global.line } : {}) }, app: plan.app.path });
      }
      for (const page of plan.pages) {
        const relevantTools = [...new Set(page.operations.map((key) => toolFor.get(key)).filter((name): name is string => name !== undefined))];
        context.push({
          id: `page:${plan.app.path}:${page.route}`,
          selected: true,
          name: page.route,
          kind: 'route',
          description: `${page.component ?? 'Page'}${page.contextCandidates.length > 0 ? `: ${page.contextCandidates.join(', ')}` : ''}${relevantTools.length > 0 ? `; tools: ${relevantTools.join(', ')}` : ''}`,
          sensitivity: 'internal',
          source: { file: page.file ?? '' },
          app: plan.app.path,
          page: { route: page.route, ...(page.component ? { component: page.component } : {}), params: page.params, ...(page.entity ? { entity: page.entity } : {}), context: page.contextCandidates, relevantTools },
        });
      }
      if (plan.pages.length === 0) warnings.push({ code: 'NO_PAGES', message: `No routes were discovered in ${plan.app.path}; only global context is proposed.`, itemId: id });
    }
    if (analysis.plans.length === 0) warnings.push({ code: 'NO_FRONTEND', message: 'No frontend app was found, so no UI or page context is proposed. The Studio and the GIX server still work (§7, §50).' });
    if (analysis.multiple) warnings.push({ code: 'CHOOSE_APPS', message: 'Several frontend apps were found; tick the ones that should get the copilot (§52).' });
    return { ...EMPTY_DRAFT, title: `App integration: ${String(integrations.length)} app(s), ${String(context.filter((item) => item.page).length)} page context(s)`, warnings, integrations, context };
  },
  async render(items: ProposalItems, { workspace }) {
    const files: RenderedFile[] = [];
    const discovery = await discoverProject(workspace);
    const frontends = classifyProject(discovery).frontends;
    for (const integration of items.integrations) {
      const firstFile = files.length;
      trustedPaths.delete(integration);
      if (!integration.selected) continue;
      const app = frontends.find((candidate) => candidate.path === integration.app && candidate.ui === integration.framework);
      if (!app?.ui) throw new Error(`Untrusted integration application: ${integration.app}`);
      const plan = await planApp(workspace, { ...app, ui: app.ui }, discovery);
      const targets = [plan.entry, plan.markup, plan.proxyConfig, plan.angularWorkspace].filter((value): value is string => value !== undefined);
      if (integration.gixDir !== plan.gixDir || integration.typescript !== plan.typescript || integration.targets.some((target) => !targets.includes(target))) {
        throw new Error(`Untrusted integration targets: ${integration.app}`);
      }
      const appContext = items.context.filter((item) => item.selected && item.app === integration.app);
      const itemIds = [integration.id, ...appContext.map((item) => item.id)];
      const globals = [...new Set([...appContext.filter((item) => !item.page).map((item) => item.name), 'locale'])];
      const extension = integration.typescript ? 'ts' : 'js';
      files.push({ path: `${integration.gixDir}/page-context.${extension}`, content: pageContextSource(integration.typescript, globals, appContext.filter((item) => item.page)), itemIds });
      const component = componentSource(integration);
      files.push({ path: component.path, content: component.content, itemIds: [integration.id] });
      for (const target of integration.targets) {
        const source = await workspace.readText(target);
        if (source === undefined) continue;
        let next: string | undefined;
        if (/vite\.config\./.test(target)) next = patchViteConfig(source);
        else if (target.endsWith('project.json') || target.endsWith('angular.json')) {
          const proxy = `${prefixOf(integration.app)}proxy.conf.json`;
          next = patchAngularProxy(source, proxy, target.endsWith('project.json'), integration.app);
          if (next) files.push({ path: proxy, content: `${JSON.stringify({ [COPILOT_API_PREFIX]: { target: COPILOT_SERVER_URL, pathRewrite: { '^/api/copilot': '' }, secure: false } }, null, 2)}\n`, itemIds: [integration.id] });
        } else if (target.endsWith('.html')) next = source.includes('<gix-copilot') ? undefined : `${source.replace(/\s*$/, '')}\n<gix-copilot />\n`;
        else {
          const specifier = relative(target, component.path).replace(/\.(tsx|jsx|ts|js)$/, '');
          const importLine = integration.framework === 'angular' ? `import { GixCopilotComponent } from '${specifier}';` : integration.framework === 'vue' ? `import GixCopilot from '${specifier}';` : `import { GixCopilot } from '${specifier}';`;
          next = patchEntry(integration.framework, source, importLine);
        }
        if (next !== undefined && next !== source) files.push({ path: target, content: next, itemIds: [integration.id] });
      }
      trustedPaths.set(integration, new Set(files.slice(firstFile).map((file) => file.path)));
    }
    return files;
  },
  validate: (items) =>
    items.integrations
      .filter((integration) => integration.selected && integration.manual.length > 0)
      .map((integration) => ({ code: 'MANUAL_STEP', message: `${integration.app}: ${integration.manual.join(' ')}`, itemId: integration.id })),
  allowedPaths: (path, items) =>
    items.integrations.some((integration) => integration.selected && trustedPaths.get(integration)?.has(path) === true),
};
