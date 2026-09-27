import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

process.env['GIX_DOCS_TEST_URL'] = 'http://127.0.0.1:5201';

export default defineConfig({
  testDir: '.',
  testMatch: 'website.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://127.0.0.1:5201',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: 'list',
  webServer: {
    command: 'pnpm exec vite preview apps/docs --config apps/docs/vite.config.ts --port 5201',
    cwd: resolve(import.meta.dirname, '../..'),
    url: 'http://127.0.0.1:5201/',
    reuseExistingServer: false,
    env: { GIX_DOCS_TEST_URL: 'http://127.0.0.1:5201' },
  },
});
