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
 * react may depend on protocol + client + context + tools + generative-ui; examples may
 * depend on anything. This is the executable form of the dependency-direction diagram in
 * docs/architecture/overview.md.
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
