import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const SITE = process.env['GIX_DOCS_TEST_URL'] ?? 'http://127.0.0.1:5200';

/** axe-core injected only in the test, never shipped with the site. */
async function axeViolations(page: Page, selector = 'body'): Promise<string[]> {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  return page.evaluate(async (target) => {
    const axeWindow = window as typeof window & { axe: { run: (node: Element, options?: object) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } };
    const node = document.querySelector(target);
    if (!node) throw new Error(`Missing ${target}`);
    const result = await axeWindow.axe.run(node, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((item) => item.target.join(' ')).slice(0, 3).join(', ')}`);
  }, selector);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/status of 404/.test(message.text())) errors.push(message.text());
  });
  return errors;
}

test.describe('GIX AI website and docs', () => {
  test.use({ baseURL: SITE, reducedMotion: 'reduce' });

  test('homepage → docs → quickstart, prerendered and hydrated without errors', async ({ page }) => {
    const errors = collectErrors(page);
    const response = await page.goto('/');
    // The prerendered HTML already contains the page (works without JavaScript, good for SEO).
    const html = (await response?.text()) ?? '';
    expect(html).toContain('that understands');
    expect(html).toContain('<link rel="canonical" href="https://ai.gixtechnology.com/"');
    expect(html).toContain('application/ld+json');
    await expect(page).toHaveTitle(/GIX AI Copilot SDK/);
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Docs' }).click();
    await expect(page).toHaveURL(`${SITE}/docs`);
    await expect(page.getByRole('heading', { level: 1, name: 'GIX AI Documentation' })).toBeVisible();
    await page.getByRole('navigation', { name: 'Documentation' }).getByRole('link', { name: 'Quickstart' }).click();
    await expect(page).toHaveURL(`${SITE}/docs/quickstart`);
    await expect(page.getByRole('heading', { level: 1, name: 'Getting started' })).toBeVisible();
    await expect(page).toHaveTitle('Getting started · GIX AI Docs');
    // Back button restores the previous page.
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'GIX AI Documentation' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('search with Ctrl+K finds an API and opens its reference entry', async ({ page }) => {
    await page.goto('/docs');
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Search documentation' });
    await expect(dialog).toBeVisible();
    await page.keyboard.type('useCopilotContext');
    await expect(dialog.getByRole('option').first()).toContainText('useCopilotContext');
    expect(await axeViolations(page, '.search-dialog')).toEqual([]);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/docs\/api\/react#useCopilotContext$/);
    await expect(page.locator('#useCopilotContext')).toBeInViewport();
    await expect(page.locator('#useCopilotContext')).toContainText('UseCopilotContextOptions');
  });

  test('copies code and switches theme (persisted across reloads)', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/docs/installation');
    await page.getByRole('button', { name: 'Copy code' }).first().click();
    await expect(page.getByRole('button', { name: 'Copied' }).first()).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('npm create @gixcopilot@latest');
    expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe('dark');
    await page.getByRole('button', { name: /^Theme: Dark/ }).click();
    expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe('light');
    await page.reload();
    // Applied before first paint by the inline bootstrap script.
    expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe('light');
    expect(await axeViolations(page, 'main')).toEqual([]);
  });

  test('mobile: website menu and docs drawer work at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole('button', { name: 'Open menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Menu' });
    await menu.getByText('Developers').click();
    await menu.getByRole('link', { name: 'Vue' }).click();
    await expect(page).toHaveURL(`${SITE}/docs/vue`);
    await page.getByRole('button', { name: 'Open documentation menu' }).click();
    const drawer = page.getByRole('dialog', { name: 'Documentation menu' });
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    // On narrow screens the table of contents is a disclosure above the article.
    await page.locator('summary', { hasText: 'On this page' }).click();
    await expect(page.locator('.toc--inline a').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test('keyboard: skip link and dropdown navigation', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    const product = page.getByRole('button', { name: 'Product' });
    await product.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('link', { name: /AI Copilot/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(product).toBeFocused();
    await expect(product).toHaveAttribute('aria-expanded', 'false');
  });

  test('accessibility (axe, WCAG 2.1 AA) on key pages in dark and light', async ({ page }) => {
    for (const path of ['/', '/docs', '/docs/security', '/docs/api/tools', '/enterprise', '/examples']) {
      await page.goto(path);
      expect(await axeViolations(page), `${path} dark`).toEqual([]);
    }
    await page.evaluate(() => localStorage.setItem('gix-theme', 'light'));
    for (const path of ['/', '/docs/react']) {
      await page.goto(path);
      expect(await axeViolations(page), `${path} light`).toEqual([]);
    }
  });

  test('RTL layout does not overflow', async ({ page }) => {
    await page.goto('/docs/tools');
    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await expect(page.locator('.gix-code pre').first()).toHaveCSS('direction', 'ltr');
  });

  test('unknown URLs return a real 404 page with search; SEO files exist', async ({ page, request }) => {
    const response = await page.goto('/docs/not-a-page');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'This page does not exist.' })).toBeVisible();
    await page.getByRole('button', { name: /Search the docs/ }).click();
    await expect(page.getByRole('dialog', { name: 'Search documentation' })).toBeVisible();
    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).toContain('<loc>https://ai.gixtechnology.com/docs/quickstart</loc>');
    expect(await (await request.get('/robots.txt')).text()).toContain('Sitemap: https://ai.gixtechnology.com/sitemap.xml');
  });
});
