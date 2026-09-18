# 0001 — Monorepo and Package Boundaries

## Status

Accepted (Phase 1).

## Context

The SDK is planned to grow to ~18 packages (`@gixcopilot/protocol`, `core`, `client`,
`server`, `react`, `angular`, `tools`, `agents`, ... — see the `ai-copilot-project` and
`nx-monorepo` skills) that must stay independently versionable, framework-independent at
the core, and free of circular or backward dependencies. Phase 1 only needs 4 packages
(`protocol`, `core`, `client`, `server`) plus one example app, but the tooling choice has
to scale to the full package set without a later rewrite.

## Decision

- Use an **Nx + pnpm** monorepo, with packages under `packages/*` and runnable
  applications/examples under `examples/*` (pnpm workspace globs in
  `pnpm-workspace.yaml`).
- Each package/app is an Nx project, with **tags** (`scope:protocol`, `scope:core`,
  `scope:client`, `scope:server`, `scope:example`) declared in its `project.json`.
- Cross-package dependency direction is enforced by `@nx/enforce-module-boundaries`
  (configured in the root `eslint.config.js`) via `depConstraints` keyed off those tags,
  not left as an informal convention.
- **No Nx plugin stack** (`@nx/js`, `@nx/vite`, `@nx/node`, etc.) is installed for target
  inference. Each project's `build` / `typecheck` / `test` / `lint` targets are explicit
  `nx:run-commands` entries in `project.json` that each just run the package's own
  `package.json` script (`tsc -b`, `vitest run`, `eslint src`). This keeps the exact
  command for every target inspectable in one place (the package's own `package.json`)
  without relying on framework-specific inference behavior that would need to be learned/
  trusted, and keeps the devDependency footprint smaller — see the dependency-policy
  skill's "keep core minimal, justify every dependency" rule.
- Each package deep-imports nothing from another package's `src/`; every package's
  `package.json` `exports` field only exposes `.` (and `./package.json`), which makes an
  illegal deep import a hard resolution failure, not just a lint warning.

## Consequences

- Adding target inference plugins later (e.g. if the `build`/`test` command shape needs to
  become more sophisticated — bundling, multiple output formats) is possible without
  restructuring the workspace; only `project.json` targets change.
- Nx caching/`affected` commands work today for the 5 current projects and will continue to
  work as more packages are added, since the tagging/boundary scheme was designed for the
  full ~18-package target from the start (see `nx-monorepo` skill), not just Phase 1's 4.
- Contributors must remember to add a `tags` entry (and a `depConstraints` rule if it's a
  new "scope") for any new package — there's no automatic default.

## Alternatives Considered

- **Turborepo instead of Nx.** Rejected: the phase's technology direction (see the
  `ai-copilot-project` skill) specifies Nx, and Nx's built-in module-boundary enforcement
  is used directly for the dependency-direction requirement (Turborepo has no equivalent
  built-in).
- **Full `@nx/js` plugin adoption for target inference.** Rejected for Phase 1: would add
  several devDependencies and "magic" auto-generated targets whose exact behavior isn't
  fully transparent from reading the repo, for no functional gain at 5 projects. Revisit
  once packages/targets multiply enough that hand-written `project.json` targets become
  repetitive.
- **A flat, single-package repo (no monorepo)** — rejected outright: the phase 1 spec and
  the long-term architecture require independently-versionable packages with enforced
  boundaries between the framework-independent core and its adapters.
