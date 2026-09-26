import { expect, test } from '@playwright/test';

const DEVTOOLS = 'http://127.0.0.1:5180';

/** Phase 11 Section 171-173, 219-221: the real DevTools UI against a real, seeded host. */
test('DevTools connects with a token and inspects agents and firewall decisions by keyboard', async ({ page }) => {
  await page.goto(DEVTOOLS);
  await page.getByLabel('Token').fill('e2e-devtools-token');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('status')).toContainText('Connected');

  const overview = page.getByRole('tab', { name: 'Overview' });
  await overview.focus();
  for (let index = 0; index < 9; index += 1) await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab', { name: 'Agents' })).toHaveAttribute('aria-selected', 'true');
  const panel = page.getByRole('tabpanel');
  await expect(panel.locator('summary strong', { hasText: 'orchestrator' })).toBeVisible();
  await expect(panel.getByText('delegated by orchestrator').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Security' }).click();
  await expect(panel.getByText('WAITING_FOR_APPROVAL').first()).toBeVisible();
  await expect(panel.getByText('DENIED').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/devtools-security-desktop.png', fullPage: true });
});

test('DevTools rejects a wrong token and stays usable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(DEVTOOLS);
  await page.getByLabel('Token').fill('wrong');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('status')).toContainText('rejected');
  await page.getByLabel('Token').fill('e2e-devtools-token');
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.getByRole('tab', { name: 'Workflows' }).click();
  await expect(page.getByRole('tabpanel').getByText('application-reassignment')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: 'test-results/devtools-workflows-mobile.png', fullPage: true });
});
