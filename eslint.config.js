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
 * vector system; only `scope:example` may depend on all of these; react may depend on
 * protocol + client + context + tools + generative-ui; examples may depend on anything. This
 * is the executable form of the dependency-direction diagram in docs/architecture/overview.md.
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
            {
              sourceTag: 'scope:react',
              onlyDependOnLibsWithTags: [
                'scope:react',
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
              sourceTag: 'scope:client',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:client'],
            },
            {
              sourceTag: 'scope:server',
              onlyDependOnLibsWithTags: [
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
  eslintConfigPrettier,
);
