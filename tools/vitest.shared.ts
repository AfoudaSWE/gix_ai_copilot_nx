import { fileURLToPath } from 'node:url';

/**
 * Shared Vitest resolution config for every package in the workspace.
 *
 * Workspace packages (`@gixcopilot/*`) are aliased straight to their TypeScript source so
 * `pnpm test` never requires `pnpm build` to have run first — mirrors the TypeScript
 * project-reference "source redirect" behavior used for typecheck (see
 * docs/architecture/overview.md and docs/adr/0005-module-resolution-and-build-strategy.md).
 */
const workspaceRoot = fileURLToPath(new URL('..', import.meta.url));

export const workspaceAliases = {
  '@gixcopilot/protocol': `${workspaceRoot}packages/protocol/src/index.ts`,
  '@gixcopilot/core': `${workspaceRoot}packages/core/src/index.ts`,
  '@gixcopilot/client': `${workspaceRoot}packages/client/src/index.ts`,
  '@gixcopilot/server': `${workspaceRoot}packages/server/src/index.ts`,
  '@gixcopilot/provider': `${workspaceRoot}packages/providers/provider-core/src/index.ts`,
  '@gixcopilot/provider-mock': `${workspaceRoot}packages/providers/mock/src/index.ts`,
  '@gixcopilot/provider-openai': `${workspaceRoot}packages/providers/openai/src/index.ts`,
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
