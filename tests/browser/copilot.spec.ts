import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';

const require = createRequire(import.meta.url);

test('popup streams, completes, regenerates, preserves history and restores keyboard focus', async ({
  page,
}) => {
  await page.goto('/');
  const launcher = page.getByRole('button', { name: 'Open copilot' });
  await launcher.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole('textbox', { name: 'Message' });
  await expect(input).toBeFocused();
  await input.fill('Explain SSE');
  await input.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Stop' })).toBeVisible();
  const log = dialog.getByRole('log');
  await expect(log).toContainText('A conversation');
  await expect(log).not.toContainText('completely custom interface');
  await expect(dialog.getByRole('button', { name: 'Regenerate' })).toBeVisible();
  await expect(log).toContainText('completely custom interface');
  await dialog.getByRole('button', { name: 'Regenerate' }).click();
  await expect(dialog.getByRole('button', { name: 'Stop' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Stop' }).click();
  await expect(dialog.getByRole('button', { name: 'Regenerate' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(launcher).toBeFocused();
  await launcher.click();
  await expect(dialog.getByRole('log').getByText('Explain SSE', { exact: true })).toHaveCount(1);
  await page.screenshot({ path: 'test-results/popup-desktop.png', fullPage: true });
});

test('failure has an explicit retry and the mock runtime recovers', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Response', exact: true }).selectOption('failure');
  await page.getByRole('button', { name: 'Open copilot' }).click();
  await page.getByRole('button', { name: 'Explain streaming responses' }).click();
  await expect(page.getByRole('alert')).toContainText('Connection lost');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Regenerate' })).toBeVisible();
  await expect(
    page.getByRole('log').getByText('Explain streaming responses', { exact: true }),
  ).toHaveCount(1);
});

test('native modal traps focus, mobile RTL fits, dark theme and reduced motion work', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByLabel('Right to left').check();
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark');
  await page.getByRole('button', { name: 'Open copilot' }).click();
  const dialog = page.getByRole('dialog');
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  const box = await dialog.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(390);
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect(
    await dialog.locator('.gix-copilot').evaluate((element) => getComputedStyle(element).direction),
  ).toBe('rtl');
  expect(
    await dialog
      .locator('.gix-copilot')
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe('rgb(23, 34, 53)');
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const violations = await page.evaluate(async () => {
    // axe is injected only in the browser test, never shipped to consumers.
    const axeWindow = window as typeof window & {
      axe: { run: (node: Element) => Promise<{ violations: { id: string }[] }> };
    };
    const modal = document.querySelector('dialog');
    if (!modal) throw new Error('Missing dialog');
    return (await axeWindow.axe.run(modal)).violations.map((violation) => violation.id);
  });
  expect(violations).toEqual([]);
  await page.screenshot({ path: 'test-results/popup-mobile-rtl-dark.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Explain streaming responses' }).click();
  await expect(dialog.locator('.gix-stream-cursor')).toBeVisible();
  expect(
    await dialog
      .locator('.gix-stream-cursor')
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe('none');
  await dialog.getByRole('button', { name: 'Stop' }).click();
});

test('long streams respect readers who scroll up and offer a jump to latest', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Response', exact: true }).selectOption('slow');
  await page.getByRole('button', { name: 'Open copilot' }).click();
  await page.getByRole('button', { name: 'Explain streaming responses' }).click();
  const log = page.getByRole('log');
  await expect
    .poll(() => log.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(100);
  await log.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(page.getByRole('button', { name: 'Regenerate' })).toBeVisible();
  expect(await log.evaluate((element) => element.scrollTop)).toBe(0);
  await page.getByRole('button', { name: 'Jump to latest' }).click();
  await expect
    .poll(() =>
      log.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight),
    )
    .toBeLessThan(2);
  await page.screenshot({ path: 'test-results/markdown-completed.png', fullPage: true });
});

test('embedded chat and nonmodal sidebar are operable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Embedded chat', exact: true }).click();
  await page.getByRole('textbox').fill('Embedded question');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'Sidebar', exact: true }).click();
  await expect(page.getByRole('complementary')).toBeVisible();
  await expect(page.getByRole('textbox')).toBeFocused();
  await page.getByRole('textbox').press('Escape');
  await expect(page.getByRole('complementary')).not.toBeVisible();
});

test('headless application works without the UI package', async ({ page }) => {
  await page.goto('http://127.0.0.1:5174');
  await page.getByRole('textbox', { name: 'Your message' }).fill('Custom interface');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('streaming');
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('status')).toHaveText('stopped');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('idle');
});
