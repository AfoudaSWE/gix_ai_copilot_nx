import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedTestConfig, workspaceAliases } from '../../tools/vitest.shared.ts';
import viteConfig from './vite.config.ts';

// Reuses the site's Vite config so the build-time data modules (search index, API data) and
// import.meta.glob content loading behave in tests exactly as in the build.
export default mergeConfig(
  viteConfig,
  defineConfig({
    resolve: { alias: workspaceAliases },
    test: { ...sharedTestConfig, environment: 'jsdom', include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'], testTimeout: 30000, setupFiles: ['src/test-setup.ts'] },
  }),
);
