/**
 * Loads documentation Markdown straight from the repository's docs/ folder. Every file is its
 * own lazy chunk, so a page only downloads the page it shows; the search index is built
 * separately at build time (see vite.config.ts).
 */
const modules = import.meta.glob<string>(
  [
    '../../../../docs/guides/*.md',
    '../../../../docs/production/*.md',
    '../../../../docs/migrations/*.md',
    '../../../../docs/ARCHITECTURE_OVERVIEW.md',
    '../../../../docs/VERSIONING.md',
    '../../../../docs/RELEASING.md',
    '../../../../docs/ROADMAP.md',
  ],
  { query: '?raw', import: 'default' },
);

const loaders = new Map<string, () => Promise<string>>(Object.entries(modules).map(([path, load]) => [path.replace(/^(\.\.\/)+/, ''), load]));
const cache = new Map<string, string>();

export function hasSource(source: string): boolean {
  return loaders.has(source);
}

/** Synchronously available content (after `loadSource`, or during prerender). */
export function cachedSource(source: string): string | undefined {
  return cache.get(source);
}

export async function loadSource(source: string): Promise<string> {
  const cached = cache.get(source);
  if (cached !== undefined) return cached;
  const load = loaders.get(source);
  if (!load) throw new Error(`Unknown documentation source: ${source}`);
  const markdown = (await load()).replace(/\r\n/g, '\n');
  cache.set(source, markdown);
  return markdown;
}

export function knownSources(): string[] {
  return [...loaders.keys()];
}
