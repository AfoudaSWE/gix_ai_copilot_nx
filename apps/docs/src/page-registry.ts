import type { ComponentType } from 'react';
import { preloadRoute, resolveRoute } from './routes.js';
import type { Route } from './routes.js';

/**
 * Route-level code splitting: each page family is its own chunk (the website does not ship
 * the Markdown renderer; the docs do not ship the homepage demos). `loadPage` fetches a route's
 * component chunk and data together, before hydration and before client-side navigation, so a
 * page is always rendered complete (no loading flash, identical server and client markup).
 */
type Kind = Route['kind'];

export interface PageProps {
  readonly home: object;
  readonly enterprise: object;
  readonly examples: object;
  readonly 'not-found': object;
  readonly 'docs-home': object;
  readonly doc: { readonly slug: string; readonly source: string };
  readonly 'api-index': object;
  readonly 'api-package': { readonly slug: string };
}

type Loaders = { readonly [K in Kind]: () => Promise<ComponentType<PageProps[K]>> };

const LOADERS: Loaders = {
  home: () => import('./site/home.js').then((module) => module.HomePage),
  enterprise: () => import('./site/pages.js').then((module) => module.EnterprisePage),
  examples: () => import('./site/pages.js').then((module) => module.ExamplesPage),
  'not-found': () => import('./site/pages.js').then((module) => module.NotFoundPage),
  'docs-home': () => import('./docs/pages.js').then((module) => module.DocsHome),
  doc: () => import('./docs/pages.js').then((module) => module.DocArticle),
  'api-index': () => import('./docs/api.js').then((module) => module.ApiIndex),
  'api-package': () => import('./docs/api.js').then((module) => module.ApiPackagePage),
};

const components = new Map<Kind, unknown>();

export function pageComponent<K extends Kind>(kind: K): ComponentType<PageProps[K]> | undefined {
  return components.get(kind) as ComponentType<PageProps[K]> | undefined;
}

async function loadComponent(kind: Kind): Promise<void> {
  if (!components.has(kind)) components.set(kind, await LOADERS[kind]());
}

/** Loads the component chunk and data for a URL path. */
export async function loadPage(pathname: string): Promise<void> {
  await Promise.all([loadComponent(resolveRoute(pathname).kind), preloadRoute(pathname)]);
}
