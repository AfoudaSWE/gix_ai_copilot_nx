/**
 * The portal's information architecture (Phase 12 Section 134). Pages are the repository's own
 * Markdown files, imported at build time, so the portal and the repository never diverge.
 */
const guides = import.meta.glob<string>('../../../docs/guides/*.md', { query: '?raw', import: 'default', eager: true });
const production = import.meta.glob<string>('../../../docs/production/*.md', { query: '?raw', import: 'default', eager: true });
const other = import.meta.glob<string>(['../../../docs/reference/*.md', '../../../docs/migrations/*.md', '../../../docs/VERSIONING.md', '../../../docs/RELEASING.md', '../../../docs/ARCHITECTURE_OVERVIEW.md', '../../../docs/ROADMAP.md'], { query: '?raw', import: 'default', eager: true });

export interface Page {
  readonly slug: string;
  readonly title: string;
  readonly section: string;
  readonly markdown: string;
  readonly source: string;
}

const SECTIONS: readonly { readonly section: string; readonly slugs: readonly string[] }[] = [
  { section: 'Getting Started', slugs: ['getting-started', 'concepts'] },
  { section: 'Frameworks', slugs: ['react', 'angular', 'vue', 'node'] },
  { section: 'Building Copilots', slugs: ['models', 'context-and-state', 'tools', 'generative-ui', 'openapi', 'mcp', 'rag', 'memory', 'agents', 'workflows'] },
  { section: 'Security', slugs: ['security', 'multi-tenancy'] },
  { section: 'Quality', slugs: ['devtools', 'testing', 'evaluations'] },
  { section: 'Production', slugs: ['production', 'deployment', 'cli', 'platform', 'DEPLOYMENT', 'CONFIGURATION', 'DATABASE', 'REDIS', 'WORKERS', 'SCALING', 'SECURITY', 'OBSERVABILITY', 'RATE_LIMITING', 'USAGE_AND_COST', 'BACKUP_RECOVERY', 'OPERATIONS'] },
  { section: 'Reference', slugs: ['api', 'ARCHITECTURE_OVERVIEW', 'VERSIONING', 'RELEASING', 'ROADMAP', 'README', 'examples'] },
];

function slugOf(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/, '');
}

function titleOf(markdown: string, slug: string): string {
  return /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? slug;
}

const all = new Map<string, { markdown: string; source: string }>();
for (const [path, markdown] of Object.entries({ ...guides, ...production, ...other })) {
  const slug = slugOf(path);
  const key = path.includes('/migrations/') ? `migration-${slug}` : slug;
  all.set(key, { markdown, source: path.replace(/^(\.\.\/)+/, '') });
}

export const PAGES: readonly Page[] = (() => {
  const pages: Page[] = [];
  const placed = new Set<string>();
  for (const { section, slugs } of SECTIONS) {
    for (const slug of slugs) {
      const entry = all.get(slug);
      if (!entry) continue;
      placed.add(slug);
      pages.push({ slug, section, title: titleOf(entry.markdown, slug), ...entry });
    }
  }
  for (const [slug, entry] of all) {
    if (placed.has(slug)) continue;
    pages.push({ slug, section: slug.startsWith('migration-') ? 'Migration Guides' : 'More', title: titleOf(entry.markdown, slug), ...entry });
  }
  return pages;
})();

/** Resolves a Markdown link inside the docs to a portal slug, or undefined for external links. */
export function linkToSlug(href: string): string | undefined {
  if (/^[a-z]+:/i.test(href) || href.startsWith('#')) return undefined;
  const file = href.split('#')[0]?.split('/').pop()?.replace(/\.md$/, '');
  if (!file) return undefined;
  return all.has(file) ? file : all.has(`migration-${file}`) ? `migration-${file}` : undefined;
}
