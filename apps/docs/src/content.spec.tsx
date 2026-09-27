import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './app.js';
import { loadSource } from './docs/content.js';
import { MarkdownPage, resolveDocHref } from './docs/markdown.js';
import { extractHeadings, slugify, summaryOf, titleOf } from './docs/markdown-utils.js';
import { DOC_PAGES, DOC_SECTIONS, docPath, neighbours, routeForSource } from './docs/nav.js';
import { parseMeta, toLines, tokenize } from './design/highlight.js';
import { loadPage } from './page-registry.js';
import { RouterProvider } from './router.js';
import { allPaths, loadApi, metaFor, resolveRoute } from './routes.js';

const repo = resolve(__dirname, '../../..');
const snippets = resolve(__dirname, '../snippets');

describe('content integrity', () => {
  it('keeps every quickstart block identical to its type-checked snippet file', () => {
    let checked = 0;
    for (const file of readdirSync(join(repo, 'docs/guides')).filter((name) => name.endsWith('.md'))) {
      const text = readFileSync(join(repo, 'docs/guides', file), 'utf8').replace(/\r\n/g, '\n');
      for (const match of text.matchAll(/<!-- snippet: ([\w.-]+) -->\n```\w+\n([\s\S]*?)```/g)) {
        const [, name, code] = match;
        expect(code, `${file} block for ${name}`).toBe(readFileSync(join(snippets, name ?? ''), 'utf8').replace(/\r\n/g, '\n'));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it('publishes every navigation entry from an existing file, with unique readable URLs', () => {
    const slugs = DOC_PAGES.map((page) => page.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const page of DOC_PAGES) {
      if (page.source) expect(existsSync(join(repo, page.source)), page.source).toBe(true);
      expect(docPath(page.slug)).toMatch(/^\/docs(\/[a-z0-9-]+(\/[a-z0-9-]+)?)?$/);
    }
    for (const required of ['quickstart', 'installation', 'react', 'vue', 'angular', 'node', 'context', 'tools', 'openapi', 'mcp', 'generative-ui', 'security', 'rag', 'memory', 'agents', 'workflows', 'devtools', 'testing', 'evals', 'production', 'cli', 'api']) {
      expect(slugs, required).toContain(required);
    }
    expect(DOC_SECTIONS.every((section) => section.pages.length > 0)).toBe(true);
  });

  it('every guide in docs/guides is published', () => {
    const published = new Set(DOC_PAGES.map((page) => page.source));
    for (const file of readdirSync(join(repo, 'docs/guides')).filter((name) => name.endsWith('.md'))) {
      expect(published.has(`docs/guides/${file}`), file).toBe(true);
    }
  });

  it('resolves Markdown links to portal routes, anchors, the repository or the web', () => {
    expect(resolveDocHref('tools.md', 'docs/guides/getting-started.md')).toEqual({ href: '/docs/tools', internal: true });
    expect(resolveDocHref('../production/REDIS.md#sizing', 'docs/guides/production.md')).toEqual({ href: '/docs/production/redis#sizing', internal: true });
    expect(resolveDocHref('../reference/api.md', 'docs/guides/cli.md')).toEqual({ href: '/docs/api', internal: true });
    expect(resolveDocHref('#install', 'docs/guides/react.md')).toEqual({ href: '#install', internal: true });
    const adr = resolveDocHref('../adr/0010-canonical-tool-architecture.md', 'docs/guides/tools.md');
    expect(adr.internal).toBe(false);
    expect(adr.href).toMatch(/\/blob\/main\/docs\/adr\/0010-canonical-tool-architecture\.md$/);
    expect(resolveDocHref('https://example.com', 'docs/guides/tools.md')).toEqual({ href: 'https://example.com', internal: false });
    expect(routeForSource('docs/guides/getting-started.md')).toBe('/docs/quickstart');
  });

  it('gives every table-of-contents entry a matching heading id in the rendered page', async () => {
    for (const page of DOC_PAGES.filter((entry) => entry.source)) {
      const markdown = await loadSource(page.source as string);
      const html = renderToString(
        <RouterProvider initialPath="/docs">
          <MarkdownPage markdown={markdown} source={page.source as string} />
        </RouterProvider>,
      );
      for (const heading of extractHeadings(markdown)) {
        expect(html, `${page.source} #${heading.id}`).toContain(`id="${heading.id}"`);
      }
    }
  });

  it('extracts titles, summaries and de-duplicated heading ids, ignoring code fences', () => {
    const markdown = '# Title `x`\n\nFirst **para** [link](a.md).\n\n## Setup\n\n```md\n## Not a heading\n```\n\n## Setup\n\n### Deep dive\n';
    expect(titleOf(markdown, 'fallback')).toBe('Title x');
    expect(summaryOf(markdown)).toBe('First para link.');
    expect(extractHeadings(markdown).map((heading) => heading.id)).toEqual(['setup', 'setup-1', 'deep-dive']);
    expect(slugify('Knowledge & RAG: “permissions”')).toBe('knowledge-rag-permissions');
  });

  it('orders pages for previous/next navigation', () => {
    expect(neighbours('quickstart').previous?.slug).toBe('installation');
    expect(neighbours('quickstart').next?.slug).toBe('architecture');
    expect(neighbours('').previous).toBeUndefined();
  });
});

describe('routing, metadata and prerender', () => {
  it('resolves readable URLs and unknown paths', () => {
    expect(resolveRoute('/')).toEqual({ kind: 'home' });
    expect(resolveRoute('/docs/production/redis')).toMatchObject({ kind: 'doc', source: 'docs/production/REDIS.md' });
    expect(resolveRoute('/docs/api/react')).toEqual({ kind: 'api-package', slug: 'react' });
    expect(resolveRoute('/docs/nope')).toEqual({ kind: 'not-found' });
  });

  it('server-renders every published route with a unique title, description and canonical URL', async () => {
    const api = await loadApi();
    const paths = allPaths(api.map((pkg) => pkg.slug));
    expect(paths.length).toBeGreaterThan(80);
    const titles = new Set<string>();
    for (const path of paths) {
      await loadPage(path);
      const html = renderToString(<App initialPath={path} />);
      expect(html, path).toMatch(/<h1[\s>]/);
      expect(html, path).not.toContain('page-loading');
      const meta = metaFor(path);
      expect(meta.description.length, path).toBeGreaterThan(20);
      expect(meta.canonical).toBe(`https://ai.gixtechnology.com${path}`);
      titles.add(meta.title);
    }
    expect(titles.size).toBe(paths.length);
  });

  it('marks the 404 page noindex', () => {
    expect(metaFor('/missing').noindex).toBe(true);
  });
});

describe('syntax highlighting', () => {
  it('tokenizes TypeScript without producing HTML', () => {
    const tokens = tokenize("const tool = defineTool({ name: 'a.b' }); // done", 'ts');
    expect(tokens.find((token) => token.text === 'const')?.type).toBe('keyword');
    expect(tokens.find((token) => token.text === 'defineTool')?.type).toBe('function');
    expect(tokens.find((token) => token.text === "'a.b'")?.type).toBe('string');
    expect(tokens.find((token) => token.text.startsWith('//'))?.type).toBe('comment');
    expect(tokens.map((token) => token.text).join('')).toBe("const tool = defineTool({ name: 'a.b' }); // done");
  });

  it('splits multi-line tokens into lines and parses fence meta', () => {
    expect(toLines(tokenize('/* a\nb */ x', 'ts'))).toHaveLength(2);
    expect(parseMeta('title="server.ts" {2,4-5}')).toEqual({ title: 'server.ts', highlight: new Set([2, 4, 5]) });
    expect(tokenize('$ npm install', 'bash')[0]).toEqual({ type: 'prompt', text: '$ ' });
    expect(tokenize('<b>x</b>', 'unknown')).toEqual([{ type: 'plain', text: '<b>x</b>' }]);
  });
});
