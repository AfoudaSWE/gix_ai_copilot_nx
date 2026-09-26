import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: 'list',
  webServer: [
    {
      command: 'node examples/react-basic/dist/server.js',
      url: 'http://127.0.0.1:4318/health',
      reuseExistingServer: false,
    },
    {
      command:
        'node examples/react-basic/node_modules/vite/bin/vite.js examples/react-basic --config examples/react-basic/vite.config.ts',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
    },
    {
      command:
        'node examples/react-custom-ui/node_modules/vite/bin/vite.js examples/react-custom-ui --config examples/react-custom-ui/vite.config.ts',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
    },
    {
      // Phase 11: the DevTools demo app, seeded with a real execution-generated session.
      command: 'node examples/devtools/dist/main.js',
      url: 'http://127.0.0.1:4100/health',
      reuseExistingServer: false,
      env: { SEED_SCENARIO: '1', DEVTOOLS_TOKEN: 'e2e-devtools-token', PORT: '4100' },
    },
    {
      command: 'node apps/devtools/node_modules/vite/bin/vite.js apps/devtools --config apps/devtools/vite.config.ts',
      url: 'http://127.0.0.1:5180',
      reuseExistingServer: false,
    },
  ],
});
