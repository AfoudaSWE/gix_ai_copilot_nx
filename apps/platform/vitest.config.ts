import { defineConfig } from 'vitest/config';
import { sharedTestConfig, workspaceAliases } from '../../tools/vitest.shared.ts';

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: { ...sharedTestConfig, environment: 'jsdom', include: ['src/**/*.spec.tsx'], testTimeout: 15000 },
});
