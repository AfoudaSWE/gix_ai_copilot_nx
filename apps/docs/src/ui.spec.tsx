import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app.js';
import { CodeBlock } from './design/code.js';
import { resolveTheme, useTheme } from './design/theme.js';
import { MarkdownPage } from './docs/markdown.js';
import { buildSearchIndex, searchIndex } from './docs/search-core.js';
import { RouterProvider } from './router.js';
import { loadPage } from './page-registry.js';

async function renderAt(path: string) {
  window.history.replaceState(null, '', path);
  await loadPage(path);
  return render(<App />);
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset['theme'] = 'dark';
});
afterEach(() => cleanup());

describe('website', () => {
  it('renders the homepage story with real install commands and navigates to the docs client-side', async () => {
    await renderAt('/');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Build AI\s*that understands\s*your application\./i);
    expect(document.body.textContent).toContain('npm create @gixcopilot@latest');
    for (const title of ['Build more than a chatbot', 'AI that builds the right interface.', 'Turn APIs into AI capabilities.', 'Understand what your AI is doing.', 'From zero to copilot.']) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
    // Only integrations the repository ships (no Anthropic/Gemini/Ollama).
    const strip = screen.getByRole('region', { name: 'Frameworks and integrations' });
    expect(strip.textContent).not.toMatch(/Anthropic|Gemini|Ollama/);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Docs' }));
    await waitFor(() => expect(window.location.pathname).toBe('/docs'));
    expect(await screen.findByRole('heading', { level: 1, name: 'GIX AI Documentation' })).toBeTruthy();
  });

  it('opens dropdowns with the keyboard and closes them with Escape', async () => {
    await renderAt('/');
    const product = screen.getByRole('button', { name: 'Product' });
    fireEvent.keyDown(product, { key: 'ArrowDown' });
    expect(product.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById(product.getAttribute('aria-controls') ?? '');
    expect(panel?.hidden).toBe(false);
    expect(within(panel as HTMLElement).getByRole('link', { name: /Generative UI/ }).getAttribute('href')).toBe('/docs/generative-ui');
    fireEvent.keyDown(panel as HTMLElement, { key: 'Escape' });
    expect(product.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the mobile menu as a modal dialog and closes it with Escape', async () => {
    await renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Menu' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull();
  });

  it('filters examples by framework and capability, with an empty state', async () => {
    await renderAt('/examples');
    fireEvent.click(within(screen.getByRole('group', { name: 'Framework' })).getByRole('button', { name: 'Angular' }));
    expect(screen.getByRole('status').textContent).toBe('1 example');
    fireEvent.click(within(screen.getByRole('group', { name: 'Capability' })).getByRole('button', { name: 'MCP' }));
    expect(screen.getByText('No example matches these filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(Number.parseInt(screen.getByRole('status').textContent ?? '0', 10)).toBeGreaterThan(15);
  });

  it('interactive demos keep their final state accessible (approval decision)', async () => {
    await renderAt('/enterprise');
    const card = screen.getByRole('group', { name: 'Approval request (demo)' });
    fireEvent.click(within(card).getByRole('button', { name: 'Reject' }));
    expect(within(card).getByRole('status').textContent).toContain('approval.rejected');
  });

  it('shows a branded 404 with search', async () => {
    await renderAt('/docs/does-not-exist');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('This page does not exist.');
    expect(screen.getByRole('button', { name: /Search the docs/ })).toBeTruthy();
  });
});

describe('documentation', () => {
  it('renders a guide with sidebar state, breadcrumb, status, edit link and previous/next', async () => {
    await renderAt('/docs/tools');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Tools');
    const sidebar = screen.getByRole('navigation', { name: 'Documentation' });
    expect(within(sidebar).getByRole('link', { name: 'Tools' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('Tools & Integrations');
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Edit this page on GitHub/ }).getAttribute('href')).toMatch(/\/edit\/main\/docs\/guides\/tools\.md$/);
    const pager = screen.getByRole('navigation', { name: 'Previous and next pages' });
    expect(within(pager).getByRole('link', { name: /Context & State/ })).toBeTruthy();
    // Internal Markdown links become client-side routes.
    fireEvent.click(within(screen.getByRole('article')).getAllByRole('link', { name: 'Action Firewall' })[0] as HTMLElement);
    await waitFor(() => expect(window.location.pathname).toBe('/docs/security'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Security' })).toBeTruthy();
  });

  it('renders the table of contents from the page headings', async () => {
    await renderAt('/docs/quickstart');
    const toc = screen.getByRole('navigation', { name: 'On this page' });
    for (const link of within(toc).getAllByRole('link')) {
      expect(document.getElementById((link.getAttribute('href') ?? '').slice(1)), link.textContent ?? '').not.toBeNull();
    }
    expect(within(toc).getByRole('link', { name: 'One command' })).toBeTruthy();
  });

  it('renders callouts, code windows and heading anchors from Markdown', () => {
    render(
      <RouterProvider initialPath="/docs/x">
        <MarkdownPage source="docs/guides/x.md" markdown={'## Keys\n\n> [!SECURITY]\n> Keys stay on the server.\n\n```ts title="server.ts" {1}\nconst a = 1;\n```\n'} />
      </RouterProvider>,
    );
    const callout = screen.getByRole('complementary', { name: 'Security' });
    expect(callout.textContent).toContain('Keys stay on the server.');
    expect(callout.textContent).not.toContain('[!SECURITY]');
    expect(screen.getByRole('link', { name: 'Link to this section' }).getAttribute('href')).toBe('#keys');
    expect(screen.getByText('server.ts')).toBeTruthy();
    expect(document.querySelector('.gix-code__line--hl')?.textContent).toContain('const a = 1;');
  });

  it('renders the generated API reference with signatures and re-export origins', async () => {
    await renderAt('/docs/api/react');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('@gixcopilot/react');
    const symbol = document.getElementById('useCopilotContext');
    expect(symbol?.textContent).toContain('function useCopilotContext<T>(options: UseCopilotContextOptions<T>): void;');
    // A type re-exported from the headless store links to where it is declared.
    const reexport = document.getElementById('ApprovalState');
    expect(within(reexport as HTMLElement).getByRole('link', { name: '@gixcopilot/headless' }).getAttribute('href')).toBe('/docs/api/headless#ApprovalState');
    fireEvent.change(screen.getByLabelText('Filter @gixcopilot/react exports'), { target: { value: 'zzz-nothing' } });
    expect(screen.getByText('No values match the filter.')).toBeTruthy();
  });

  it('filters the API index by symbol name', async () => {
    await renderAt('/docs/api');
    fireEvent.change(screen.getByLabelText('Filter packages and APIs'), { target: { value: 'defineTool' } });
    const matches = screen.getByRole('region', { name: 'Matching APIs' });
    expect(within(matches).getByRole('link', { name: 'defineTool' }).getAttribute('href')).toBe('/docs/api/tools#defineTool');
  });

  it('opens search with Ctrl+K, navigates results with the keyboard and closes with Escape', async () => {
    await renderAt('/docs');
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Search documentation' });
    const input = within(dialog).getByRole('combobox');
    fireEvent.change(input, { target: { value: 'useFrontendTool' } });
    await waitFor(() => expect(within(dialog).getAllByRole('option').length).toBeGreaterThan(1));
    const first = within(dialog).getAllByRole('option')[0] as HTMLElement;
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(first.id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(within(dialog).getAllByRole('option')[1]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/docs\/api\//));
    expect(screen.queryByRole('dialog', { name: 'Search documentation' })).toBeNull();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const again = await screen.findByRole('dialog', { name: 'Search documentation' });
    fireEvent.change(within(again).getByRole('combobox'), { target: { value: 'qqqxyz' } });
    await waitFor(() => expect(within(again).getByText(/No results for/)).toBeTruthy());
    fireEvent.keyDown(again, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Search documentation' })).toBeNull();
  });

  it('opens the docs drawer on small screens and closes it on navigation', async () => {
    await renderAt('/docs/react');
    fireEvent.click(screen.getByRole('button', { name: 'Open documentation menu' }));
    const drawer = screen.getByRole('dialog', { name: 'Documentation menu' });
    fireEvent.click(within(drawer).getByRole('link', { name: 'Vue' }));
    await waitFor(() => expect(window.location.pathname).toBe('/docs/vue'));
    expect(screen.queryByRole('dialog', { name: 'Documentation menu' })).toBeNull();
  });
});

describe('search ranking', () => {
  const index = buildSearchIndex(
    [{ url: '/docs/security', label: 'Security Overview', group: 'Security', markdown: '# Security\n\nThe Action Firewall checks every call.\n\n## Approvals\n\nHumans decide.\n' }],
    [{ name: '@gixcopilot/react', slug: 'react', description: 'React adapter', values: [{ name: 'useCopilotContext', kind: 'function', signature: 'function useCopilotContext()' }], types: [] }],
  );

  it('ranks exact API names first and groups results by category', () => {
    const groups = searchIndex(index, 'useCopilotContext');
    expect(groups[0]?.group).toBe('API Reference');
    expect(groups[0]?.results[0]?.url).toBe('/docs/api/react#useCopilotContext');
  });

  it('finds sections by heading and pages by body text, requiring every term', () => {
    expect(searchIndex(index, 'approvals').flatMap((group) => group.results)[0]?.url).toBe('/docs/security#approvals');
    expect(searchIndex(index, 'firewall').flatMap((group) => group.results).some((entry) => entry.url === '/docs/security')).toBe(true);
    expect(searchIndex(index, 'firewall nonexistentterm')).toEqual([]);
    expect(searchIndex(index, '   ')).toEqual([]);
  });
});

describe('theme and code', () => {
  it('defaults to dark, cycles dark → light → system and persists the choice', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    let api: ReturnType<typeof useTheme> | undefined;
    function Probe() {
      api = useTheme();
      return null;
    }
    render(<Probe />);
    act(() => api?.cycle());
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(localStorage.getItem('gix-theme')).toBe('light');
    act(() => api?.cycle());
    expect(localStorage.getItem('gix-theme')).toBe('system');
    act(() => api?.cycle());
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('copies code with feedback and toggles wrapping', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CodeBlock code={'npm create @gixcopilot@latest\n'} language="bash" title="Terminal" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith('npm create @gixcopilot@latest');
    const wrap = screen.getByRole('button', { name: 'Wrap long lines' });
    fireEvent.click(wrap);
    expect(wrap.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.gix-code--wrap')).not.toBeNull();
  });
});
