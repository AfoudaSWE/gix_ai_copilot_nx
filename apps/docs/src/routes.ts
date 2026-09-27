import { cachedSource, loadSource } from './docs/content.js';
import { DOC_PAGES, docPath, findDoc } from './docs/nav.js';
import { summaryOf, titleOf } from './docs/markdown-utils.js';
import { SITE } from './site.js';

/** Resolved route: which page renders a URL. */
export type Route =
  | { readonly kind: 'home' }
  | { readonly kind: 'enterprise' }
  | { readonly kind: 'examples' }
  | { readonly kind: 'docs-home' }
  | { readonly kind: 'doc'; readonly slug: string; readonly source: string }
  | { readonly kind: 'api-index' }
  | { readonly kind: 'api-package'; readonly slug: string }
  | { readonly kind: 'not-found' };

export function resolveRoute(pathname: string): Route {
  if (pathname === '/') return { kind: 'home' };
  if (pathname === '/enterprise') return { kind: 'enterprise' };
  if (pathname === '/examples') return { kind: 'examples' };
  if (pathname === '/docs') return { kind: 'docs-home' };
  if (pathname === '/docs/api') return { kind: 'api-index' };
  const api = /^\/docs\/api\/([a-z0-9-]+)$/.exec(pathname);
  if (api?.[1]) return { kind: 'api-package', slug: api[1] };
  if (pathname.startsWith('/docs/')) {
    const page = findDoc(pathname.slice('/docs/'.length));
    if (page?.source) return { kind: 'doc', slug: page.slug, source: page.source };
  }
  return { kind: 'not-found' };
}

/* ------------------------------------------------------------------ API data (lazy chunk) */

export interface ApiItem {
  readonly name: string;
  readonly kind?: string;
  readonly signature?: string;
}
export interface ApiPackage {
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly status: 'stable' | 'beta' | 'experimental';
  readonly directory: string;
  readonly subpaths: readonly string[];
  readonly peerDependencies: readonly string[];
  readonly values: readonly ApiItem[];
  readonly types: readonly ApiItem[];
}

let apiData: readonly ApiPackage[] | undefined;
let apiPromise: Promise<readonly ApiPackage[]> | undefined;
export function cachedApi(): readonly ApiPackage[] | undefined {
  return apiData;
}
export function loadApi(): Promise<readonly ApiPackage[]> {
  apiPromise ??= import('virtual:gix-api').then((module) => {
    apiData = (module.default as { readonly packages: readonly ApiPackage[] }).packages;
    return apiData;
  });
  return apiPromise;
}

/** Loads everything a route needs so the server render and hydration see the same data. */
export async function preloadRoute(pathname: string): Promise<void> {
  const route = resolveRoute(pathname);
  if (route.kind === 'doc') await loadSource(route.source);
  if (route.kind === 'api-index' || route.kind === 'api-package') await loadApi();
}

/* ------------------------------------------------------------------ SEO metadata */

export interface PageMeta {
  readonly title: string;
  readonly description: string;
  readonly canonical: string;
  readonly type: 'website' | 'article';
  readonly noindex?: boolean;
}

const suffix = (title: string): string => `${title} · GIX AI Docs`;

export function metaFor(pathname: string): PageMeta {
  const route = resolveRoute(pathname);
  const canonical = `${SITE.url}${pathname === '/' ? '/' : pathname}`;
  switch (route.kind) {
    case 'home':
      return { title: 'GIX AI Copilot SDK: build AI that understands your application', description: SITE.description, canonical, type: 'website' };
    case 'enterprise':
      return { title: 'Enterprise AI with boundaries · GIX AI', description: 'The AI Action Firewall, RBAC and ABAC, human-in-the-loop approvals, audit, multi-tenancy, PII protection and usage controls built into the GIX AI runtime.', canonical, type: 'website' };
    case 'examples':
      return { title: 'Examples · GIX AI', description: 'Runnable GIX AI examples for React, Angular and Node: tools, generative UI, RAG, agents, workflows, security, OpenAPI and MCP.', canonical, type: 'website' };
    case 'docs-home':
      return { title: 'GIX AI Documentation', description: 'Build secure, application-aware AI copilots and agents with TypeScript: quickstart, React, Vue, Angular and Node guides, tools, generative UI, security, RAG, agents and production.', canonical, type: 'website' };
    case 'api-index':
      return { title: suffix('API Reference'), description: 'Every public export of every @gixcopilot package, generated from the type declarations each package ships.', canonical, type: 'article' };
    case 'api-package': {
      const pkg = cachedApi()?.find((item) => item.slug === route.slug);
      return { title: suffix(pkg ? `${pkg.name} API` : 'API Reference'), description: pkg?.description ?? 'Package API reference.', canonical, type: 'article' };
    }
    case 'doc': {
      const markdown = cachedSource(route.source);
      const entry = findDoc(route.slug);
      const title = markdown ? titleOf(markdown, entry?.label ?? route.slug) : (entry?.label ?? route.slug);
      return { title: suffix(title), description: (markdown && summaryOf(markdown, 160)) || entry?.description || SITE.description, canonical, type: 'article' };
    }
    case 'not-found':
      return { title: 'Page not found · GIX AI', description: 'This page does not exist.', canonical, type: 'website', noindex: true };
  }
}

/** Every URL the prerender writes (and the sitemap lists). */
export function allPaths(apiSlugs: readonly string[]): string[] {
  return ['/', '/enterprise', '/examples', ...DOC_PAGES.map((page) => (page.slug === 'api' ? '/docs/api' : docPath(page.slug))), ...apiSlugs.map((slug) => `/docs/api/${slug}`)].filter((path, index, list) => list.indexOf(path) === index);
}
