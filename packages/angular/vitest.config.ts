import { defineConfig } from 'vitest/config';
import { sharedTestConfig, workspaceAliases } from '../../tools/vitest.shared.ts';

// Tests run the adapter in Angular's JIT mode (the `@angular/compiler` import in
// test-setup.ts) with legacy decorators compiled by Vite; the published build is AOT
// (partial Ivy) via ng-packagr.
export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    ...sharedTestConfig,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.spec.ts'],
  },
});
