import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const require = createRequire(import.meta.url);

// The Developer Studio attached to a real createCopilot server (examples/studio), discovering a
// throwaway copy of the sample app, so applying proposals never touches the repository.
const STUDIO = 'http://127.0.0.1:4120/__gix';

async function command(page: Page, name: string): Promise<void> {
  await page.keyboard.press('Control+K');
  const input = page.getByRole('combobox');
  await expect(input).toBeFocused();
  await input.fill(name);
  await page.keyboard.press('Enter');
}

test('discover, generate, review, approve and apply from the keyboard-accessible Studio', async ({ page }) => {
  await page.goto(STUDIO);
  await expect(page.getByRole('heading', { name: 'GIX Copilot', level: 2 })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Diagnostics' })).toContainText('Project Discovery');

  await command(page, 'Discover Project');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Discovery' })).toBeFocused();
  await expect(main.getByRole('row', { name: /API Operations 4/ })).toBeVisible();
  await expect(main.getByRole('row', { name: /Components 1/ })).toBeVisible();

  await page.getByRole('navigation').getByRole('button', { name: 'Generators' }).click();
  await main.locator('.card', { hasText: 'OpenAPI → Tools' }).getByRole('button', { name: 'Generate proposal' }).click();
  await expect(main.getByRole('heading', { name: 'Review', exact: true })).toBeVisible();
  await expect(main.getByText('+ .gix/tools/applications-api.openapi.ts')).toBeVisible();
  await expect(main.getByRole('checkbox', { name: 'Include applications.delete' })).not.toBeChecked();

  await main.getByRole('button', { name: 'Approve Selected Changes' }).click();
  await expect(main.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await main.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(main.getByRole('heading', { name: 'APPLY COMPLETE' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Diagnostics' })).toContainText('applied');
});

test('the Appearance preview is the real @gixcopilot/ui and updates live', async ({ page }) => {
  await page.goto(STUDIO);
  await page.getByRole('navigation').getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  const chat = page.frameLocator('iframe[title="Live copilot preview"]').locator('.gix-copilot');
  await expect(chat).toBeVisible();
  await page.getByLabel('Primary color').fill('#e11d2e');
  await page.getByLabel('Title', { exact: true }).fill('Portal Copilot');
  await expect.poll(() => chat.evaluate((element) => getComputedStyle(element).getPropertyValue('--copilot-primary').trim())).toBe('#e11d2e');
  await expect(chat.getByRole('heading', { name: 'Portal Copilot' })).toBeVisible();
});

test('Test Copilot talks to the real runtime from the preview', async ({ page }) => {
  await page.goto(STUDIO);
  await command(page, 'Test Copilot');
  const frame = page.frameLocator('iframe[title="Live copilot preview"]');
  const input = frame.getByRole('textbox');
  await input.fill('Hello?');
  await input.press('Enter');
  // The reply also reaches the live region, so take the rendered message itself.
  await expect(frame.getByText('Hello from the sample copilot (mock provider).').first()).toBeVisible();
});

test.describe('accessibility', () => {
  // The Studio's CSP allows only its own nonce'd script; axe is injected for the test only.
  test.use({ bypassCSP: true });

  test('the Studio page has no axe violations', async ({ page }) => {
    await page.goto(STUDIO);
    await expect(page.getByRole('heading', { name: 'GIX Copilot', level: 2 })).toBeVisible();
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    const violations = await page.evaluate(async () => {
      const axeWindow = window as typeof window & { axe: { run: (node: Element) => Promise<{ violations: { id: string }[] }> } };
      return (await axeWindow.axe.run(document.body)).violations.map((violation) => violation.id);
    });
    expect(violations).toEqual([]);
  });
});
