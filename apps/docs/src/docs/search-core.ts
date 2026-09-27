import { sectionsOf, summaryOf, titleOf } from './markdown-utils.js';

/**
 * Documentation search: the index is built at build time (vite.config.ts → a lazily loaded
 * chunk, fetched only when search opens) and queried in the browser. Pure functions only.
 */
export interface SearchEntry {
  readonly title: string;
  readonly url: string;
  /** Result group: a docs section, "API Reference", "CLI" or "Website". */
  readonly group: string;
  readonly kind: 'page' | 'section' | 'api' | 'cli' | 'site';
  /** Parent page title (for sections) or package name (for API symbols). */
  readonly context?: string;
  readonly text: string;
}

export interface IndexPage {
  readonly url: string;
  readonly label: string;
  readonly group: string;
  readonly markdown?: string;
  readonly description?: string;
}

export interface IndexApiPackage {
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly values: readonly { readonly name: string; readonly kind?: string; readonly signature?: string }[];
  readonly types: readonly { readonly name: string; readonly kind?: string; readonly signature?: string }[];
}

export const CLI_COMMANDS: readonly { readonly command: string; readonly text: string }[] = [
  { command: 'npm create @gixcopilot', text: 'Add a copilot to a React, Vue or Angular app with a Node copilot server, in one command.' },
  { command: 'aicopilot init', text: 'Create a copilot project (templates: node, react, angular, enterprise).' },
  { command: 'aicopilot add tool', text: 'Add a typed tool with tests.' },
  { command: 'aicopilot add agent', text: 'Add an agent definition with tests.' },
  { command: 'aicopilot add mcp', text: 'Configure an MCP server (no tools exposed by default).' },
  { command: 'aicopilot mcp list', text: 'List configured MCP servers.' },
  { command: 'aicopilot add api', text: 'Connect any HTTP/GraphQL API: writes an API manifest to fill in.' },
  { command: 'aicopilot api check', text: 'Validate an API manifest and list the tools it creates.' },
  { command: 'aicopilot mcp serve', text: 'Serve an API as an MCP server (stdio or HTTP), through the Action Firewall.' },
  { command: 'aicopilot import-openapi', text: 'Import an OpenAPI document (all operations disabled).' },
  { command: 'aicopilot dev', text: 'Validate configuration, then run your dev script.' },
  { command: 'aicopilot test', text: 'Run your tests with the test environment.' },
  { command: 'aicopilot eval', text: 'Run an evaluation suite (CI gates, --json output).' },
  { command: 'aicopilot doctor', text: 'Check Node, configuration, providers, database, Redis, migrations, tools, MCP, OpenAPI and telemetry.' },
  { command: 'aicopilot db', text: 'Database migrations: status, migrate, rollback.' },
];

const clip = (text: string, max = 200): string => (text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : text);

export function buildSearchIndex(pages: readonly IndexPage[], api: readonly IndexApiPackage[], site: readonly IndexPage[] = []): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const page of site) entries.push({ title: page.label, url: page.url, group: 'Website', kind: 'site', text: page.description ?? '' });
  for (const page of pages) {
    const title = page.markdown ? titleOf(page.markdown, page.label) : page.label;
    entries.push({ title: page.label, url: page.url, group: page.group, kind: 'page', text: clip(`${title === page.label ? '' : `${title}. `}${page.description ?? (page.markdown ? summaryOf(page.markdown, 220) : '')}`) });
    if (!page.markdown) continue;
    for (const section of sectionsOf(page.markdown)) {
      if (!section.heading) continue;
      entries.push({ title: section.heading.text, url: `${page.url}#${section.heading.id}`, group: page.group, kind: 'section', context: page.label, text: clip(section.text) });
    }
  }
  for (const pkg of api) {
    entries.push({ title: pkg.name, url: `/docs/api/${pkg.slug}`, group: 'API Reference', kind: 'api', context: 'Package', text: clip(pkg.description) });
    for (const item of [...pkg.values, ...pkg.types]) {
      const name = item.name.replace(/ \(namespace\)$/, '');
      entries.push({ title: name, url: `/docs/api/${pkg.slug}#${encodeURIComponent(name)}`, group: 'API Reference', kind: 'api', context: pkg.name, text: clip(item.signature ?? item.kind ?? '', 140) });
    }
  }
  for (const cli of CLI_COMMANDS) entries.push({ title: cli.command, url: '/docs/cli', group: 'CLI', kind: 'cli', text: cli.text });
  return entries;
}

function scoreEntry(entry: SearchEntry, terms: readonly string[], phrase: string): number {
  const title = entry.title.toLowerCase();
  const haystack = `${title} ${(entry.context ?? '').toLowerCase()} ${entry.text.toLowerCase()}`;
  if (!terms.every((term) => haystack.includes(term))) return 0;
  let score = 1;
  if (title === phrase) score += 120;
  else if (title.startsWith(phrase)) score += 70;
  else if (title.includes(phrase)) score += 40;
  for (const term of terms) {
    if (new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(title)) score += 12;
    else if (title.includes(term)) score += 6;
  }
  score += { page: 10, site: 8, cli: 6, api: 4, section: 2 }[entry.kind];
  // Very long API symbol lists shouldn't bury guides for broad words.
  if (entry.kind === 'api' && !title.includes(terms[0] ?? '')) score -= 3;
  return score;
}

export interface SearchGroup {
  readonly group: string;
  readonly results: readonly SearchEntry[];
}

/** Ranked results grouped by category (groups ordered by their best result). */
export function searchIndex(entries: readonly SearchEntry[], query: string, limit = 24): SearchGroup[] {
  const phrase = query.trim().toLowerCase();
  if (!phrase) return [];
  const terms = phrase.split(/\s+/).filter(Boolean);
  const ranked = entries
    .map((entry) => ({ entry, score: scoreEntry(entry, terms, phrase) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.title.length - b.entry.title.length)
    .slice(0, limit);
  const groups = new Map<string, SearchEntry[]>();
  for (const { entry } of ranked) {
    const list = groups.get(entry.group) ?? [];
    list.push(entry);
    groups.set(entry.group, list);
  }
  return [...groups].map(([group, results]) => ({ group, results }));
}
