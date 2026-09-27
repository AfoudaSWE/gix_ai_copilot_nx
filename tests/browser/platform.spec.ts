import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const PLATFORM = 'http://127.0.0.1:5190';
const DEVTOOLS = 'http://127.0.0.1:5180';

async function signIn(page: Page, token: string): Promise<void> {
  await page.goto(PLATFORM);
  await page.getByLabel('Access token').fill(token);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Platform sections' })).toBeVisible();
}

async function open(page: Page, section: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Platform sections' }).getByRole('link', { name: section, exact: true }).click();
  await expect(page.getByRole('heading', { name: section, level: 2 }).first()).toBeVisible();
}

/** axe-core, injected only in tests; returns serious/critical violations. */
async function axeViolations(page: Page, selector = 'body'): Promise<string[]> {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  return page.evaluate(async (root) => {
    const axeWindow = window as typeof window & { axe: { run: (node: Element) => Promise<{ violations: { id: string; impact?: string }[] }> } };
    const node = document.querySelector(root);
    if (!node) return ['missing-root'];
    const result = await axeWindow.axe.run(node);
    return result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => violation.id);
  }, selector);
}

/** Phase 12 Section 195: the real platform UI against the real management service. */
test('platform: project, model, knowledge, agents, evaluation, traces, audit and usage', async ({ page }) => {
  await signIn(page, 'dev-owner');
  await expect(page.getByText(/acme · olivia · owner/)).toBeVisible();

  await open(page, 'Projects');
  const createProject = page.getByRole('form', { name: 'Create project' });
  await createProject.getByLabel('Name').fill('Visa Platform');
  await createProject.getByLabel('Slug').fill('visa');
  await createProject.getByRole('button', { name: 'Create project' }).click();
  await expect(createProject.getByRole('status')).toContainText('development, staging and production');
  await expect(page.getByRole('cell', { name: 'Visa Platform' })).toBeVisible();

  await open(page, 'Settings');
  const secret = page.getByRole('form', { name: 'Store secret' });
  await secret.getByLabel('Secret name').fill('openai-key');
  await secret.getByLabel('Secret value').fill('sk-e2e-secret-value-000000000000');
  await secret.getByRole('button', { name: 'Store secret' }).click();
  await expect(secret.getByRole('status')).toContainText('cannot be shown again');
  await expect(page.locator('body')).not.toContainText('sk-e2e-secret-value');

  await open(page, 'Models');
  const addModel = page.getByRole('form', { name: 'Add model' });
  await addModel.getByLabel('Name').fill('primary');
  await addModel.getByRole('button', { name: 'Add model' }).click();
  await expect(page.getByRole('cell', { name: 'primary' })).toBeVisible();

  await open(page, 'Tools');
  await expect(page.getByRole('cell', { name: 'payments.refund' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'supervisor' })).toBeVisible();

  await open(page, 'Knowledge');
  const addSource = page.getByRole('form', { name: 'Add knowledge-source' });
  await addSource.getByLabel('Name').fill('handbook');
  await addSource.getByRole('button', { name: 'Add knowledge-source' }).click();
  await page.getByRole('button', { name: 'Reindex handbook' }).click();
  await expect(page.getByText(/Reindex of handbook queued/)).toBeVisible();

  await open(page, 'Agents');
  await expect(page.getByRole('cell', { name: 'support' })).toBeVisible();

  await open(page, 'Evaluations');
  await expect(page.getByRole('cell', { name: 'smoke@1' })).toBeVisible();
  const startEval = page.getByRole('form', { name: 'Start evaluation' });
  await startEval.getByLabel('Dataset id').fill('smoke');
  await startEval.getByRole('button', { name: 'Start evaluation' }).click();
  await expect(startEval.getByRole('status')).toContainText('Evaluation queued');

  await open(page, 'Traces');
  await expect(page.getByText('completed').first()).toBeVisible();

  await open(page, 'Audit');
  await expect(page.getByRole('cell', { name: 'management.project.create' })).toBeVisible();

  await open(page, 'Usage');
  await expect(page.getByRole('cell', { name: 'mock/dev' }).or(page.getByRole('cell', { name: 'dev' })).first()).toBeVisible();
  await expect(page.getByText(/estimated/i).first()).toBeVisible();

  expect(await axeViolations(page)).toEqual([]);
});

test('platform: roles and tenants are enforced server-side; keyboard, RTL and phone width work', async ({ page }) => {
  await signIn(page, 'dev-viewer');
  const nav = page.getByRole('navigation', { name: 'Platform sections' });
  await expect(nav.getByRole('link', { name: 'Audit' })).toHaveCount(0);
  await open(page, 'Projects');
  await expect(page.getByRole('form', { name: 'Create project' })).toHaveCount(0);

  // Keyboard: the skip link works, and sections are reachable and operable by keyboard.
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await skip.focus();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await nav.getByRole('link', { name: 'Usage', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Usage', level: 2 })).toBeFocused();

  await page.getByRole('button', { name: 'RTL' }).click();
  await expect(page.locator('.shell')).toHaveAttribute('dir', 'rtl');
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(await axeViolations(page)).toEqual([]);

  // Another tenant sees none of Acme's conversations.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, 'dev-other');
  await open(page, 'Conversations');
  await expect(page.getByText('Nothing here yet.')).toBeVisible();
});

test('DevTools UI has no serious accessibility violations', async ({ page }) => {
  await page.goto(DEVTOOLS);
  await page.getByLabel('Token').fill('e2e-devtools-token');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('status')).toContainText('Connected');
  expect(await axeViolations(page)).toEqual([]);
});
