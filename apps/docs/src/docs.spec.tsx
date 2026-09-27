import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './app.js';
import { PAGES } from './content.js';

const docs = resolve(__dirname, '../../../docs');
const snippets = resolve(__dirname, '../snippets');

afterEach(() => {
  cleanup();
  globalThis.location.hash = '';
});

describe('documentation portal', () => {
  it('keeps every quickstart block identical to its type-checked snippet file', () => {
    let checked = 0;
    for (const file of readdirSync(join(docs, 'guides')).filter((name) => name.endsWith('.md'))) {
      const text = readFileSync(join(docs, 'guides', file), 'utf8').replace(/\r\n/g, '\n');
      for (const match of text.matchAll(/<!-- snippet: ([\w.-]+) -->\n```\w+\n([\s\S]*?)```/g)) {
        const [, name, code] = match;
        const source = readFileSync(join(snippets, name ?? ''), 'utf8').replace(/\r\n/g, '\n');
        expect(code, `${file} block for ${name}`).toBe(source);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it('covers the documentation information architecture', () => {
    const slugs = new Set(PAGES.map((page) => page.slug));
    for (const slug of ['getting-started', 'concepts', 'react', 'angular', 'node', 'models', 'context-and-state', 'tools', 'generative-ui', 'security', 'openapi', 'mcp', 'rag', 'memory', 'agents', 'workflows', 'devtools', 'testing', 'evaluations', 'production', 'deployment', 'multi-tenancy', 'cli', 'platform', 'api', 'examples', 'DEPLOYMENT', 'CONFIGURATION', 'DATABASE', 'SECURITY', 'VERSIONING', 'migration-phase-12']) {
      expect(slugs.has(slug), slug).toBe(true);
    }
  });

  it('renders an accessible portal with search and in-app navigation', async () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Documentation' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Getting started');
    fireEvent.change(screen.getByLabelText('Search documentation'), { target: { value: 'ng-packagr' } });
    const angular = within(nav).getByRole('link', { name: 'Angular' });
    fireEvent.click(angular);
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Angular');
    expect(angular.getAttribute('aria-current')).toBe('page');
    // Internal Markdown links navigate inside the portal.
    fireEvent.change(screen.getByLabelText('Search documentation'), { target: { value: '' } });
    fireEvent.click(within(nav).getByRole('link', { name: 'Getting started' }));
    const concepts = (await screen.findAllByRole('link', { name: 'Concepts' })).find((link) => link.closest('main'));
    expect(concepts?.getAttribute('href')).toBe('#/concepts');
  });
});
