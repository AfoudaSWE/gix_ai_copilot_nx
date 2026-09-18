---
name: nx-monorepo
description: Nx + pnpm monorepo conventions - package organization, tags, dependency boundaries, buildable/publishable libraries, affected commands, and caching. Load when adding, moving, or restructuring packages.
---

# Purpose

Keep the monorepo's package graph enforceable by tooling rather than by convention alone,
so [[project-architecture]]'s dependency-direction rules are checked automatically.

# When to Apply

Adding a new package/library, moving code between packages, wiring up build/test/lint
targets, or reviewing a change that touches more than one package.

# Required Rules

- Package manager is pnpm; workspace and task orchestration is Nx. Do not introduce a
  second package manager or task runner.
- Every library is tagged (`nx.json` / project tags) by layer (`scope:core`, `scope:react`,
  `scope:angular`, `scope:server`, `scope:adapter`, etc.) and Nx module-boundary lint rules
  enforce that a package may only depend on layers permitted by [[project-architecture]].
- Apps consume libraries; libraries do not depend on apps.
- Publishable/public packages live under a distinct path (e.g. `packages/`) from internal-
  only libraries (e.g. `libs/internal/`); publishable libraries must declare a real
  `package.json` with correct `main`/`types`/`exports` fields.
- Every library defines `build` (if publishable), `test`, `lint`, and `typecheck` targets
  using consistent executors across the workspace — do not hand-roll a one-off target shape
  per package.
- Use `nx affected` (`nx affected -t lint,test,typecheck,build`) for CI and for local
  verification after a change — do not run the full workspace graph when affected scoping
  is available and sufficient.
- Respect Nx's computation cache; do not disable caching to "fix" a flaky task — fix the
  task's determinism instead.
- Package naming follows the `@gixcopilot/<name>` scope. Names are singular, lower-kebab,
  and describe the package's responsibility, not its implementation detail (e.g.
  `@gixcopilot/tools`, not `@gixcopilot/zod-tool-helpers`).
- Cross-package imports must go through a package's published entry point, never through a
  relative path reaching into another package's `src/`.
- Planned package set (not to be scaffolded ahead of the approved phase):
  `@gixcopilot/protocol`, `core`, `client`, `server`, `react`, `angular`, `ui`, `agents`,
  `tools`, `context`, `memory`, `rag`, `openapi`, `mcp`, `security`, `telemetry`, `evals`,
  `devtools`.

# Anti-Patterns

- A `libs/core` package with a module-boundary tag that allows depending on `scope:react`.
- Hand-importing `../../../react/src/hooks/useCopilot` from a non-React package.
- Adding a new library without tags, so boundary lint silently doesn't apply to it.
- Running `nx run-many --all` in CI when `nx affected` would correctly scope the change.
- Scaffolding all 18 planned packages up front "for the roadmap" before the phase needs them
  — see [[phase-gate]].

# Validation Checklist

- [ ] New/changed library has correct tags and passes Nx module-boundary lint
- [ ] Publishable libraries have correct `package.json` entry points
- [ ] `test`, `lint`, `typecheck` targets exist and pass for touched projects
- [ ] `nx affected --graph` (or equivalent) shows no unintended new dependency edges
- [ ] No cross-package deep import into another package's internals
