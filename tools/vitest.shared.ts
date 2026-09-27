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
  '@gixcopilot/react': `${workspaceRoot}packages/react/src/index.ts`,
  '@gixcopilot/ui': `${workspaceRoot}packages/ui/src/index.ts`,
  '@gixcopilot/protocol': `${workspaceRoot}packages/protocol/src/index.ts`,
  '@gixcopilot/context': `${workspaceRoot}packages/context/src/index.ts`,
  '@gixcopilot/core': `${workspaceRoot}packages/core/src/index.ts`,
  '@gixcopilot/tools': `${workspaceRoot}packages/tools/src/index.ts`,
  '@gixcopilot/generative-ui': `${workspaceRoot}packages/generative-ui/src/index.ts`,
  '@gixcopilot/headless': `${workspaceRoot}packages/headless/src/index.ts`,
  '@gixcopilot/angular': `${workspaceRoot}packages/angular/src/index.ts`,
  '@gixcopilot/vue': `${workspaceRoot}packages/vue/src/index.ts`,
  '@gixcopilot/node': `${workspaceRoot}packages/node/src/index.ts`,
  '@gixcopilot/config': `${workspaceRoot}packages/config/src/index.ts`,
  '@gixcopilot/tenancy': `${workspaceRoot}packages/tenancy/src/index.ts`,
  '@gixcopilot/persistence-postgres': `${workspaceRoot}packages/persistence-postgres/src/index.ts`,
  '@gixcopilot/redis': `${workspaceRoot}packages/redis/src/index.ts`,
  '@gixcopilot/model-router': `${workspaceRoot}packages/model-router/src/index.ts`,
  '@gixcopilot/usage': `${workspaceRoot}packages/usage/src/index.ts`,
  '@gixcopilot/management': `${workspaceRoot}packages/management/src/index.ts`,
  '@gixcopilot/cli': `${workspaceRoot}packages/cli/src/index.ts`,
  '@gixcopilot/client': `${workspaceRoot}packages/client/src/index.ts`,
  '@gixcopilot/security': `${workspaceRoot}packages/security/src/index.ts`,
  '@gixcopilot/openapi': `${workspaceRoot}packages/openapi/src/index.ts`,
  '@gixcopilot/connectors': `${workspaceRoot}packages/connectors/src/index.ts`,
  '@gixcopilot/mcp': `${workspaceRoot}packages/mcp/src/index.ts`,
  '@gixcopilot/integrations': `${workspaceRoot}packages/integrations/src/index.ts`,
  '@gixcopilot/knowledge': `${workspaceRoot}packages/knowledge/src/index.ts`,
  '@gixcopilot/rag': `${workspaceRoot}packages/rag/src/index.ts`,
  '@gixcopilot/vectorstore-pgvector': `${workspaceRoot}packages/vectorstores/pgvector/src/index.ts`,
  '@gixcopilot/memory': `${workspaceRoot}packages/memory/src/index.ts`,
  '@gixcopilot/server': `${workspaceRoot}packages/server/src/index.ts`,
  '@gixcopilot/provider': `${workspaceRoot}packages/providers/provider-core/src/index.ts`,
  '@gixcopilot/provider-mock': `${workspaceRoot}packages/providers/mock/src/index.ts`,
  '@gixcopilot/provider-openai': `${workspaceRoot}packages/providers/openai/src/index.ts`,
  '@gixcopilot/agents': `${workspaceRoot}packages/agents/src/index.ts`,
  '@gixcopilot/workflows': `${workspaceRoot}packages/workflows/src/index.ts`,
  '@gixcopilot/telemetry': `${workspaceRoot}packages/telemetry/src/index.ts`,
  // The subpath entry precedes its package entry so the longer specifier wins.
  '@gixcopilot/devtools/server': `${workspaceRoot}packages/devtools/src/server/index.ts`,
  '@gixcopilot/devtools': `${workspaceRoot}packages/devtools/src/index.ts`,
  '@gixcopilot/testing': `${workspaceRoot}packages/testing/src/index.ts`,
  '@gixcopilot/evals': `${workspaceRoot}packages/evals/src/index.ts`,
  '@gixcopilot/jobs': `${workspaceRoot}packages/jobs/src/index.ts`,
  '@gixcopilot/checkpoint-postgres': `${workspaceRoot}packages/checkpoint-postgres/src/index.ts`,
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
