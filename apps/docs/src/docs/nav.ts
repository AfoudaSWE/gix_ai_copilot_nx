import type { IconName } from '../design/icons.js';
import type { Status } from '../design/components.js';

/**
 * The documentation information architecture. Every page is a real Markdown file in the
 * repository (the single source of truth); URLs are readable (/docs/tools, /docs/production/redis).
 * `status` mirrors the capability maturity table in README.md.
 */
export interface DocEntry {
  /** Path after /docs/ ('' is the docs home). */
  readonly slug: string;
  /** Sidebar label (the page's H1 is used as the document title). */
  readonly label: string;
  /** Repository-relative Markdown source; absent for generated pages (home, API reference). */
  readonly source?: string;
  readonly status?: Status;
  readonly description?: string;
}

export interface DocSection {
  readonly title: string;
  readonly icon: IconName;
  readonly pages: readonly DocEntry[];
}

const guide = (slug: string, label: string, file: string, extra: Partial<DocEntry> = {}): DocEntry => ({ slug, label, source: `docs/guides/${file}.md`, ...extra });
const prod = (slug: string, label: string, file: string): DocEntry => ({ slug: `production/${slug}`, label, source: `docs/production/${file}.md`, status: 'experimental' });

export const DOC_SECTIONS: readonly DocSection[] = [
  {
    title: 'Getting Started',
    icon: 'rocket',
    pages: [
      { slug: '', label: 'Introduction', description: 'What GIX AI is and where to start.' },
      guide('installation', 'Installation', 'installation'),
      guide('quickstart', 'Quickstart', 'getting-started'),
      { slug: 'architecture', label: 'Architecture', source: 'docs/ARCHITECTURE_OVERVIEW.md' },
      guide('concepts', 'Core Concepts', 'concepts'),
      guide('examples', 'Examples', 'examples'),
    ],
  },
  {
    title: 'Frameworks',
    icon: 'layers',
    pages: [guide('react', 'React', 'react', { status: 'beta' }), guide('vue', 'Vue', 'vue', { status: 'beta' }), guide('angular', 'Angular', 'angular', { status: 'beta' }), guide('node', 'Node.js', 'node', { status: 'beta' }), guide('nextjs', 'Next.js', 'nextjs', { status: 'beta' })],
  },
  { title: 'Application Awareness', icon: 'eye', pages: [guide('context', 'Context & State', 'context-and-state', { status: 'beta' })] },
  {
    title: 'Tools & Integrations',
    icon: 'tool',
    pages: [guide('tools', 'Tools', 'tools', { status: 'beta' }), guide('connectors', 'Connect Any API', 'connectors', { status: 'beta' }), guide('openapi', 'OpenAPI', 'openapi', { status: 'beta' }), guide('mcp', 'MCP', 'mcp', { status: 'beta' })],
  },
  { title: 'Generative UI', icon: 'layout', pages: [guide('generative-ui', 'Generative UI', 'generative-ui', { status: 'beta' })] },
  { title: 'Models', icon: 'sparkles', pages: [guide('models', 'Models & Routing', 'models', { status: 'beta' }), guide('real-openai', 'Real OpenAI example', 'REAL_OPENAI_EXAMPLE')] },
  {
    title: 'Security',
    icon: 'shield',
    pages: [guide('security', 'Security Overview', 'security', { status: 'beta' }), guide('multi-tenancy', 'Multi-Tenancy', 'multi-tenancy', { status: 'beta' }), prod('security', 'Production Hardening', 'SECURITY')],
  },
  { title: 'Knowledge & Memory', icon: 'database', pages: [guide('rag', 'Knowledge & RAG', 'rag', { status: 'beta' }), guide('memory', 'Memory', 'memory', { status: 'beta' })] },
  { title: 'Agents & Workflows', icon: 'workflow', pages: [guide('agents', 'Agents', 'agents', { status: 'beta' }), guide('workflows', 'Workflows', 'workflows', { status: 'beta' })] },
  { title: 'Observability', icon: 'activity', pages: [guide('devtools', 'DevTools & Tracing', 'devtools', { status: 'beta' }), prod('observability', 'Production Observability', 'OBSERVABILITY')] },
  { title: 'Testing & Evaluations', icon: 'flask', pages: [guide('testing', 'Testing', 'testing', { status: 'beta' }), guide('evals', 'Evaluations', 'evaluations', { status: 'beta' })] },
  {
    title: 'Production',
    icon: 'building',
    pages: [
      guide('production', 'Production Overview', 'production', { status: 'experimental' }),
      guide('deployment', 'Deployment', 'deployment', { status: 'experimental' }),
      prod('configuration', 'Configuration', 'CONFIGURATION'),
      prod('database', 'PostgreSQL', 'DATABASE'),
      prod('redis', 'Redis', 'REDIS'),
      prod('workers', 'Workers', 'WORKERS'),
      prod('rate-limiting', 'Rate Limiting', 'RATE_LIMITING'),
      prod('usage-and-cost', 'Usage & Cost', 'USAGE_AND_COST'),
      prod('scaling', 'Scaling', 'SCALING'),
      prod('docker', 'Docker & Compose', 'DEPLOYMENT'),
      prod('operations', 'Operations', 'OPERATIONS'),
      prod('backup-recovery', 'Backup & Recovery', 'BACKUP_RECOVERY'),
      guide('platform', 'Management Platform', 'platform', { status: 'experimental' }),
    ],
  },
  { title: 'CLI', icon: 'terminal', pages: [guide('cli', 'CLI', 'cli', { status: 'beta' })] },
  {
    title: 'Reference',
    icon: 'book',
    pages: [
      { slug: 'api', label: 'API Reference', description: 'Every public export of every package.' },
      { slug: 'versioning', label: 'Versioning', source: 'docs/VERSIONING.md' },
      { slug: 'releasing', label: 'Releasing', source: 'docs/RELEASING.md' },
      { slug: 'migrations', label: 'Migrations', source: 'docs/migrations/README.md' },
      { slug: 'migrations/phase-12', label: 'Migration: Phase 12', source: 'docs/migrations/phase-12.md' },
      { slug: 'roadmap', label: 'Roadmap', source: 'docs/ROADMAP.md' },
    ],
  },
];

export const DOC_PAGES: readonly (DocEntry & { readonly section: string })[] = DOC_SECTIONS.flatMap((section) => section.pages.map((page) => ({ ...page, section: section.title })));

export const docPath = (slug: string): string => (slug ? `/docs/${slug}` : '/docs');

const BY_SOURCE = new Map(DOC_PAGES.filter((page) => page.source).map((page) => [page.source as string, page.slug]));

/** The generated API reference replaces the Markdown one. */
BY_SOURCE.set('docs/reference/api.md', 'api');

/** Maps a repository path (e.g. docs/guides/tools.md) to its docs URL, if the portal publishes it. */
export function routeForSource(path: string): string | undefined {
  const slug = BY_SOURCE.get(path);
  return slug === undefined ? undefined : docPath(slug);
}

export function findDoc(slug: string) {
  return DOC_PAGES.find((page) => page.slug === slug);
}

/** Previous/next pages in reading order. */
export function neighbours(slug: string) {
  const index = DOC_PAGES.findIndex((page) => page.slug === slug);
  return { previous: index > 0 ? DOC_PAGES[index - 1] : undefined, next: index >= 0 ? DOC_PAGES[index + 1] : undefined };
}
