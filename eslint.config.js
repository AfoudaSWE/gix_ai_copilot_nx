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
 * contract; the provider contract (`@gixcopilot/provider`) may depend on protocol + core;
 * provider adapters (mock, openai) may depend on protocol + core + the provider contract,
 * but never on each other; `@gixcopilot/context` (Phase 4) may depend only on protocol - it
 * must never depend on React; react may depend on protocol + client + context; examples may
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
              sourceTag: 'scope:core',
              onlyDependOnLibsWithTags: ['scope:protocol', 'scope:core'],
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
