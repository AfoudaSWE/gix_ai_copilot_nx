// @ts-check
import tseslint from 'typescript-eslint';
import nxEslintPlugin from '@nx/eslint-plugin';
import eslintConfigPrettier from 'eslint-config-prettier';

/**
 * Workspace-wide ESLint flat config.
 *
 * Module boundaries (dependency direction between packages) are enforced here via
 * `@nx/enforce-module-boundaries`, per the project-architecture and nx-monorepo skills:
 * protocol must not depend on anything else in the workspace; core may depend on protocol;
 * client may depend on protocol; server may depend on protocol + core + the provider
 * contract + tools; the provider contract (`@gixcopilot/provider`) may depend on protocol +
 * core; provider adapters (mock, openai) may depend on protocol + core + the provider
 * contract, but never on each other; `@gixcopilot/context` (Phase 4) may depend only on
 * protocol - it must never depend on React; `@gixcopilot/tools` (Phase 5) may depend only on
 * protocol - it is the framework-independent canonical tool package shared by server and
 * react, and must never depend on React, Fastify, or a provider SDK; `@gixcopilot/generative-ui`
 * (Phase 6) may depend on protocol + tools + context - it must never depend on React;
 * `@gixcopilot/security` (Phase 7) may depend only on protocol + tools - the framework-
 * independent AI Action Firewall/HITL/audit engine, consumed by server (never by react/ui
 * directly - approval-related React state is built from protocol-level event types only);
 * `@gixcopilot/openapi` and `@gixcopilot/mcp` (Phase 8) may each depend only on protocol +
 * tools - they generate canonical `ToolDefinition`s from an external source and register
 * them into a caller-supplied `ToolRegistry`, never owning a second tool runtime;
 * `@gixcopilot/integrations` (Phase 8) may depend only on protocol - a thin, source-agnostic
 * registry tracking integration health/metadata; `@gixcopilot/knowledge` (Phase 9) may depend
 * on protocol + mcp (an MCP-resource loader reuses Phase 8's MCP client) - source/document/
 * loader contracts only, no chunking/embedding/vector-store concern; `@gixcopilot/rag`
 * (Phase 9) may depend on protocol + security + knowledge - chunking, embeddings, the
 * `VectorStore` abstraction, permission-aware retrieval (reuses `SecurityContext`/`Policy`/
 * `DataPolicy` rather than a second authorization model), reranking, citations; never a
 * PostgreSQL/Drizzle dependency itself; `@gixcopilot/vectorstore-pgvector` (Phase 9) may
 * depend on protocol + rag - the only package allowed to import `drizzle-orm`/`pg`, isolating
 * that dependency from the core RAG abstractions per the database skill;
 * `@gixcopilot/memory` (Phase 9) may depend on protocol + security + rag - reuses rag's
 * `EmbeddingProvider`/`VectorStore` for semantic memory rather than a second, incompatible
 * vector system; `@gixcopilot/agents` (Phase 10) may depend on protocol + core + tools +
 * security + provider - the framework-independent agent runtime (definition, registry,
 * routing, delegation, handoff, planner/executor); deliberately never depends on rag/memory/
 * context (an agent's knowledge/context is composed at the application layer, not hard-wired
 * into the agent core) or React; `@gixcopilot/workflows` (Phase 10) may depend on protocol +
 * core + tools + security + agents - the deterministic workflow engine, defining
 * `CheckpointStore`/`JobExecutor` as ports rather than depending on Postgres/Redis directly;
 * `@gixcopilot/jobs` (Phase 10) may depend on protocol + workflows - the BullMQ/Redis
 * `JobExecutor` adapter; `@gixcopilot/checkpoint-postgres` (Phase 10) may depend on protocol +
 * workflows - the Drizzle/Postgres `CheckpointStore` adapter, the only other package besides
 * `vectorstore-pgvector` allowed to import `drizzle-orm`/`pg`; only `scope:example` may
 * depend on all of these; react may depend on protocol + client + context + tools +
 * generative-ui; examples may depend on anything. This is the executable form of the
 * dependency-direction diagram in docs/architecture/overview.md.
 * Telemetry depends only on protocol and itself; examples may use telemetry.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/web-dist/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.ts',
      '.claude/**',
      'docs/**',
      '**/*.md',
      // A standalone MCP server script (Section 71's example), spawned directly by `node`
      // with no build step - deliberately plain JS outside every TS project (see its own
      // doc comment), so it is not part of the type-checked TS project service.
      'examples/mcp/src/mcp-server-process.mjs',
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@nx': nxEslintPlugin,
    },
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            // Phase 12 browser/server boundary: browser packages (client, react, ui, angular)
            // may only depend on browser or platform-neutral packages, and neutral packages
            // only on neutral ones, so a server dependency (provider SDK, pg, ioredis, BullMQ,
            // Fastify) can never reach a browser bundle through the package graph.
            { sourceTag: 'platform:browser', onlyDependOnLibsWithTags: ['platform:browser', 'platform:neutral'] },
            { sourceTag: 'platform:neutral', onlyDependOnLibsWithTags: ['platform:neutral'] },
            {
              sourceTag: 'scope:react',
              onlyDependOnLibsWithTags: [
                'scope:react',
                'scope:headless',
                'scope:client',
                'scope:protocol',
                'scope:context',
                'scope:tools',
                'scope:generative-ui',
              ],
            },
            {
              sourceTag: 'scope:ui',
              onlyDependOnLibsWithTags: ['scope:ui', 'scope:react'],
            },
            {
              sourceTag: 'scope:protocol',
              onlyDependOnLibsWithTags: ['scope:protocol'],
            },
            {
              sourceTag: 'scope:context',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:context'],
            },
            {
              sourceTag: 'scope:tools',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:tools'],
            },
            {
              sourceTag: 'scope:generative-ui',
              onlyDependOnLibsWithTags: [
                'scope:protocol',
                'scope:tools',
                'scope:context',
                'scope:generative-ui',
              ],
            },
            {
              sourceTag: 'scope:core',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:core'],
            },
            {
              sourceTag: 'scope:security',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:tools', 'scope:security'],
            },
            {
              sourceTag: 'scope:openapi',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:tools', 'scope:openapi'],
            },
            {
              sourceTag: 'scope:mcp',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:tools', 'scope:mcp'],
            },
            {
              sourceTag: 'scope:integrations',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:integrations'],
            },
            {
              sourceTag: 'scope:knowledge',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:mcp', 'scope:knowledge'],
            },
            {
              sourceTag: 'scope:rag',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:security', 'scope:knowledge', 'scope:rag'],
            },
            {
              sourceTag: 'scope:vectorstore-pgvector',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:rag', 'scope:vectorstore-pgvector'],
            },
            {
              sourceTag: 'scope:memory',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:security', 'scope:rag', 'scope:memory'],
            },
            {
              sourceTag: 'scope:agents',
              onlyDependOnLibsWithTags: [
                'scope:protocol',
                'scope:core',
                'scope:tools',
                'scope:security',
                'scope:provider',
                'scope:provider-adapter',
                'scope:telemetry',
                'scope:agents',
              ],
            },
            {
              sourceTag: 'scope:workflows',
              onlyDependOnLibsWithTags: [
                'scope:protocol',
                'scope:core',
                'scope:tools',
                'scope:security',
                'scope:agents',
                'scope:telemetry',
                'scope:workflows',
              ],
            },
            {
              sourceTag: 'scope:telemetry',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:telemetry'],
            },
            {
              // Observes the runtime only through telemetry diagnostics - never imports a
              // runtime package, so it cannot become the runtime (Phase 11 Section 7).
              sourceTag: 'scope:devtools',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:telemetry', 'scope:devtools'],
            },
            {
              // The DevTools UI consumes the DevTools API/bundles only - never server or
              // runtime internals (Phase 11 Section 26). Eval reports are loaded as JSON.
              sourceTag: 'scope:devtools-app',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:telemetry', 'scope:devtools', 'scope:evals'],
            },
            {
              // Generic eval core: no agents/provider-SDK dependency (Section 226). It reuses
              // DevTools' diagnostics projection to build execution records.
              sourceTag: 'scope:evals',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:telemetry', 'scope:devtools', 'scope:evals'],
            },
            {
              // Test-only leaf: may compose every runtime package, but nothing depends on it.
              sourceTag: 'scope:testing',
              onlyDependOnLibsWithTags: [
                'scope:protocol',
                'scope:core',
                'scope:server',
                'scope:context',
                'scope:tools',
                'scope:security',
                'scope:knowledge',
                'scope:rag',
                'scope:memory',
                'scope:provider',
                'scope:provider-adapter',
                'scope:agents',
                'scope:workflows',
                'scope:telemetry',
                'scope:devtools',
                'scope:testing',
              ],
            },
            {
              sourceTag: 'scope:jobs',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:workflows', 'scope:jobs'],
            },
            {
              sourceTag: 'scope:checkpoint-postgres',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:workflows', 'scope:checkpoint-postgres'],
            },
            {
              sourceTag: 'scope:client',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:client'],
            },
            {
              sourceTag: 'scope:server',
              onlyDependOnLibsWithTags: [
                'scope:telemetry',
                'scope:protocol',
                'scope:core',
                'scope:server',
                'scope:provider',
                'scope:tools',
                'scope:security',
              ],
            },
            {
              sourceTag: 'scope:provider',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:core', 'scope:provider'],
            },
            {
              sourceTag: 'scope:provider-adapter',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:core', 'scope:provider'],
            },
            {
              sourceTag: 'scope:headless',
              onlyDependOnLibsWithTags: ['scope:headless', 'scope:protocol', 'scope:client', 'scope:context', 'scope:tools', 'scope:generative-ui'],
            },
            {
              sourceTag: 'scope:angular',
              onlyDependOnLibsWithTags: ['scope:angular', 'scope:headless', 'scope:protocol', 'scope:client', 'scope:context', 'scope:tools', 'scope:generative-ui'],
            },
            {
              sourceTag: 'scope:connectors',
              onlyDependOnLibsWithTags: ['scope:connectors', 'scope:openapi', 'scope:tools', 'scope:protocol'],
            },
            {
              sourceTag: 'scope:create',
              onlyDependOnLibsWithTags: ['scope:create'],
            },
            {
              sourceTag: 'scope:vue',
              onlyDependOnLibsWithTags: ['scope:vue', 'scope:headless', 'scope:protocol', 'scope:client', 'scope:context', 'scope:tools', 'scope:generative-ui'],
            },
            {
              sourceTag: 'scope:node',
              onlyDependOnLibsWithTags: ['scope:node', 'scope:protocol', 'scope:core', 'scope:client', 'scope:provider', 'scope:provider-adapter', 'scope:security', 'scope:server', 'scope:telemetry', 'scope:tools'],
            },
            {
              // Development plane only (ADR 0023): the Developer Studio discovers, proposes and
              // applies approved changes. Nothing in the application plane may depend on it.
              sourceTag: 'scope:studio',
              onlyDependOnLibsWithTags: ['scope:studio', 'scope:protocol', 'scope:security', 'scope:tools', 'scope:openapi', 'scope:provider', 'scope:core'],
            },
            {
              // The Studio's live preview bundle: the real UI, nothing else (ADR 0023).
              sourceTag: 'scope:studio-preview',
              onlyDependOnLibsWithTags: ['scope:studio-preview', 'scope:react', 'scope:ui'],
            },
            {
              sourceTag: 'scope:config',
              onlyDependOnLibsWithTags: ['scope:config'],
            },
            {
              sourceTag: 'scope:tenancy',
              onlyDependOnLibsWithTags: ['scope:tenancy', 'scope:protocol', 'scope:security', 'scope:tools'],
            },
            {
              sourceTag: 'scope:persistence-postgres',
              onlyDependOnLibsWithTags: ['scope:management', 'scope:devtools', 'scope:evals', 'scope:openapi', 'scope:usage', 'scope:redis', 'scope:node', 'scope:provider-adapter', 'scope:server', 'scope:provider', 'scope:core', 'scope:client', 'scope:telemetry', 'scope:persistence-postgres', 'scope:protocol', 'scope:security', 'scope:memory', 'scope:tenancy', 'scope:checkpoint-postgres', 'scope:vectorstore-pgvector', 'scope:rag', 'scope:workflows', 'scope:tools'],
            },
            {
              sourceTag: 'scope:redis',
              onlyDependOnLibsWithTags: ['scope:redis'],
            },
            {
              sourceTag: 'scope:model-router',
              onlyDependOnLibsWithTags: ['scope:model-router', 'scope:protocol', 'scope:provider', 'scope:core', 'scope:node', 'scope:provider-adapter', 'scope:security', 'scope:tools', 'scope:server', 'scope:client', 'scope:telemetry'],
            },
            {
              sourceTag: 'scope:usage',
              onlyDependOnLibsWithTags: ['scope:usage', 'scope:protocol', 'scope:security', 'scope:tenancy', 'scope:node', 'scope:provider-adapter', 'scope:redis'],
            },
            {
              sourceTag: 'scope:management',
              onlyDependOnLibsWithTags: ['scope:management', 'scope:protocol', 'scope:security', 'scope:tenancy', 'scope:usage', 'scope:devtools', 'scope:evals', 'scope:openapi', 'scope:telemetry', 'scope:tools'],
            },
            {
              // The platform UI talks to the management API over HTTP only; the server packages
              // are used by its tests (in-process API), never imported by src (checked below).
              sourceTag: 'scope:platform-app',
              onlyDependOnLibsWithTags: ['scope:management', 'scope:security', 'scope:tenancy', 'scope:usage'],
            },
            {
              // Deployable server/worker apps compose any server-side SDK package.
              sourceTag: 'scope:api-app',
              onlyDependOnLibsWithTags: ['platform:server', 'platform:neutral'],
            },
            {
              sourceTag: 'scope:cli',
              onlyDependOnLibsWithTags: ['scope:cli', 'scope:connectors', 'scope:config', 'scope:evals', 'scope:openapi', 'scope:persistence-postgres', 'scope:tools', 'scope:devtools', 'scope:telemetry', 'scope:protocol', 'scope:tenancy', 'scope:management', 'scope:usage', 'scope:security', 'scope:memory', 'scope:checkpoint-postgres', 'scope:vectorstore-pgvector', 'scope:rag', 'scope:workflows', 'scope:knowledge', 'scope:mcp', 'scope:core', 'scope:agents', 'scope:provider', 'scope:redis', 'scope:node', 'scope:server', 'scope:client', 'scope:provider-adapter'],
            },
            {
              // The docs portal renders Markdown; SDK packages are used only by type-checked snippets.
              sourceTag: 'scope:docs-app',
              onlyDependOnLibsWithTags: ['platform:browser', 'platform:neutral', 'platform:server'],
            },
            {
              sourceTag: 'scope:example',
              onlyDependOnLibsWithTags: [
                'scope:react',
                'scope:ui',
                'scope:protocol',
                'scope:core',
                'scope:client',
                'scope:server',
                'scope:provider',
                'scope:provider-adapter',
                'scope:context',
                'scope:tools',
                'scope:generative-ui',
                'scope:security',
                'scope:openapi',
                'scope:mcp',
                'scope:integrations',
                'scope:knowledge',
                'scope:rag',
                'scope:vectorstore-pgvector',
                'scope:memory',
                'scope:agents',
                'scope:workflows',
                'scope:telemetry',
                'scope:jobs',
                'scope:checkpoint-postgres',
                'scope:devtools',
                'scope:testing',
                'scope:evals',
                'scope:headless',
                'scope:angular',
                'scope:vue',
                'scope:create',
                'scope:connectors',
                'scope:node',
                'scope:config',
                'scope:tenancy',
                'scope:persistence-postgres',
                'scope:redis',
                'scope:model-router',
                'scope:usage',
                'scope:management',
                'scope:cli',
                'scope:studio',
                'scope:example',
              ],
            },
          ],
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    // Browser and platform-neutral packages must not import Node built-ins (Phase 12 Section
    // 147). Tests, test harnesses and the devtools server subpath run in Node and are exempt.
    files: [
      'packages/{client,react,ui,angular,vue,headless,protocol,core,context,tools,generative-ui,telemetry,devtools,security,integrations,tenancy}/src/**/*.{ts,tsx}',
      'packages/providers/{provider-core,mock}/src/**/*.ts',
    ],
    ignores: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.spec-helper.ts', '**/test-*.ts', 'packages/devtools/src/server/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: 'Browser/neutral packages must not import Node built-ins.' },
            { group: ['fastify', 'pg', 'ioredis', 'bullmq', 'openai', 'drizzle-orm', 'drizzle-orm/*'], message: 'Server-only dependency in a browser/neutral package.' },
          ],
        },
      ],
    },
  },
  {
    // Developer Studio (ADR 0023): discovery and generators are read-only by construction.
    // They see the repository only through ReadonlyWorkspace and may not reach a writer.
    files: ['packages/studio/src/{discovery,generators}/**/*.ts'],
    ignores: ['**/*.spec.ts', '**/*.spec-helper.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/apply/*', '**/apply/**'], message: 'Generators and discovery must not reach the apply engine: generate() never writes.' },
            { group: ['node:fs', 'node:fs/*', 'fs', 'fs/*', 'node:child_process', 'child_process'], message: 'Use ReadonlyWorkspace; discovery and generators never write files or spawn processes.' },
          ],
        },
      ],
    },
  },
  {
    // The management platform UI reaches the system only through the management HTTP API.
    files: ['apps/platform/src/**/*.{ts,tsx}'],
    ignores: ['**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@gixcopilot/*'], message: 'The platform UI must use the management HTTP API, not SDK/server packages.' },
            { group: ['node:*', 'fastify', 'pg', 'ioredis', 'bullmq', 'openai', 'drizzle-orm'], message: 'Server-only dependency in the platform UI.' },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
);
