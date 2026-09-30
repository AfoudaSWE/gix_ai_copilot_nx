import { canonicalOperationKey } from './normalize.js';
import type { ComponentInfo, ContextCandidate, NormalizedApiOperation, PageInfo, RouteInfo } from './model.js';

/** What page analysis needs to know about one analyzed source file. */
export interface FileFacts {
  readonly calls: readonly { readonly method: string; readonly path: string; readonly owner?: string }[];
  readonly imports: Readonly<Record<string, string>>;
  readonly importedNames: Readonly<Record<string, readonly string[]>>;
}

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue', '/index.ts', '/index.tsx', '/index.js'];

/** Resolves a relative import specifier to a known file. Bare (package) imports are ignored. */
function resolveImport(from: string, specifier: string, files: ReadonlySet<string>): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const parts = from.split('/').slice(0, -1);
  for (const segment of specifier.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.') parts.push(segment);
  }
  const base = parts.join('/').replace(/\.(js|mjs)$/, '');
  if (files.has(base)) return base;
  return CODE_EXTENSIONS.map((extension) => `${base}${extension}`).find((candidate) => files.has(candidate));
}

const singular = (word: string): string => word.replace(/ies$/, 'y').replace(/(ses|xes)$/, (match) => match.slice(0, -2)).replace(/s$/, '');
const camel = (word: string): string => word.replace(/[-_](\w)/g, (_match, next: string) => next.toUpperCase());

/**
 * Page analysis (§30). For each frontend route: the page component and its file, the API
 * operations the page and the files it imports call (one level deep), route parameters, the
 * entity the route is about, and context candidates. The page model is a proposal input, never
 * a registration.
 */
export function analyzePages(input: {
  readonly routes: readonly RouteInfo[];
  readonly components: readonly ComponentInfo[];
  readonly facts: ReadonlyMap<string, FileFacts>;
  readonly operations: readonly NormalizedApiOperation[];
  readonly contextCandidates: readonly ContextCandidate[];
}): (PageInfo & { readonly routeFile: string })[] {
  const files = new Set(input.facts.keys());
  const known = new Set(input.operations.map((operation) => operation.key));
  const byRoute = new Map<string, PageInfo & { readonly routeFile: string }>();
  for (const route of input.routes.filter((entry) => entry.kind === 'frontend' && entry.path !== '' && entry.path !== '**' && !entry.path.includes('*'))) {
    const params = [...route.path.matchAll(/[:{]([A-Za-z_]\w*)\}?/g)].map((match) => match[1] ?? 'param');
    const literals = route.path.split('/').filter((segment) => segment && !segment.startsWith(':') && !segment.startsWith('{'));
    const entity = params.length > 0 && literals.length > 0 ? camel(singular(literals.at(-1) ?? '')) : undefined;
    // The page file: the route's own file (Next.js pages), the named component's file, or the
    // file the route definition imports the component from.
    let file: string | undefined = route.component ? undefined : route.file;
    if (route.component) {
      const specifier = input.facts.get(route.file)?.imports[route.component];
      file = specifier ? resolveImport(route.file, specifier, files) : undefined;
      file ??= input.components.find((component) => component.name === route.component && component.file === route.file)?.file;
      if (!file && !specifier) {
        const directory = route.file.slice(0, route.file.lastIndexOf('/') + 1);
        const local = input.components.filter((component) => component.name === route.component && component.file.startsWith(directory));
        if (local.length === 1) file = local[0]?.file;
      }
    }
    // The page's own calls, plus calls inside the functions it imports (by name) from app files.
    const pageFiles = new Set<string>();
    const calls: { method: string; path: string }[] = [];
    if (file) {
      pageFiles.add(file);
      calls.push(...(input.facts.get(file)?.calls ?? []));
      for (const [specifier, names] of Object.entries(input.facts.get(file)?.importedNames ?? {})) {
        const resolved = resolveImport(file, specifier, files);
        if (!resolved) continue;
        pageFiles.add(resolved);
        const all = names.includes('*');
        calls.push(...(input.facts.get(resolved)?.calls ?? []).filter((call) => all || (call.owner !== undefined && names.includes(call.owner))));
      }
    }
    const operations = [...new Set(calls.map((call) => canonicalOperationKey(call.method, call.path)))].filter((key) => known.has(key));
    const contextCandidates = [
      ...params.map((param) => (param === 'id' && entity ? `${entity}Id` : param)),
      ...(entity ? [`current${entity.charAt(0).toUpperCase()}${entity.slice(1)}`] : []),
      ...input.contextCandidates.filter((candidate) => pageFiles.has(candidate.file)).map((candidate) => candidate.name),
    ];
    const page = { route: route.path, routeFile: route.file, params, ...(route.component ? { component: route.component } : {}), ...(file ? { file } : {}), operations, contextCandidates: [...new Set(contextCandidates)], ...(entity ? { entity } : {}) };
    // Deduplicate within a route source, never across apps that happen to use the same URL.
    const key = `${route.file}:${route.path}`;
    const existing = byRoute.get(key);
    if (!existing || existing.operations.length < page.operations.length) byRoute.set(key, page);
  }
  return [...byRoute.values()].sort((a, b) => a.route.localeCompare(b.route));
}
