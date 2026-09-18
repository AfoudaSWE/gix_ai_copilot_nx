import { fileURLToPath } from 'node:url';

/**
 * Shared Vitest resolution config for every package in the workspace.
 *
 * Workspace packages (`@aicopilot/*`) are aliased straight to their TypeScript source so
 * `pnpm test` never requires `pnpm build` to have run first — mirrors the TypeScript
 * project-reference "source redirect" behavior used for typecheck (see
 * docs/architecture/overview.md and docs/adr/0005-module-resolution-and-build-strategy.md).
 */
const workspaceRoot = fileURLToPath(new URL('..', import.meta.url));

export const workspaceAliases = {
  '@aicopilot/protocol': `${workspaceRoot}packages/protocol/src/index.ts`,
  '@aicopilot/core': `${workspaceRoot}packages/core/src/index.ts`,
  '@aicopilot/client': `${workspaceRoot}packages/client/src/index.ts`,
  '@aicopilot/server': `${workspaceRoot}packages/server/src/index.ts`,
  '@aicopilot/provider': `${workspaceRoot}packages/providers/provider-core/src/index.ts`,
  '@aicopilot/provider-mock': `${workspaceRoot}packages/providers/mock/src/index.ts`,
  '@aicopilot/provider-openai': `${workspaceRoot}packages/providers/openai/src/index.ts`,
};

export const sharedTestConfig = {
  globals: false as const,
  environment: 'node' as const,
  include: ['src/**/*.spec.ts'],
  reporters: ['default' as const],
  coverage: {
    provider: 'v8' as const,
    reportsDirectory: 'coverage',
    include: ['src/**/*.ts'],
    exclude: ['src/**/*.spec.ts'],
  },
};
