import { defineConfig } from 'vitest/config';
import { sharedTestConfig, workspaceAliases } from '../../tools/vitest.shared.ts';
export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    ...sharedTestConfig,
    environment: 'node',
    include: ['src/**/*.spec.tsx', 'src/**/*.spec.ts'],
    testTimeout: 15000,
  },
});
