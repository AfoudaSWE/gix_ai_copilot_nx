# 0005 — Module Resolution and Build Strategy

## Status

Accepted (Phase 1).

## Context

Section 39 of the Phase 1 spec requires deciding and documenting a module strategy
("Do not overcomplicate dual CJS/ESM support unless there is a clear requirement") and
package entry points suitable for eventual publishing, without publishing anything yet.
Separately, a TypeScript monorepo with real cross-package type-checking needs a concrete
answer for how one package's `tsconfig` resolves another workspace package's types.

## Decision

- **ESM only.** Every package sets `"type": "module"`; `tsconfig.base.json` sets
  `"module": "NodeNext"` and `"moduleResolution": "NodeNext"`. No CJS build output is
  produced. This is a deliberate simplification (per the spec's explicit guidance) — there
  is no current consumer requiring CommonJS.
- **NodeNext's `.js`-extension convention** is used throughout: relative imports inside
  `.ts` source files are written with a `.js` extension (e.g. `from './errors.js'`), which
  TypeScript resolves to the sibling `.ts` file at check time and leaves unchanged in the
  emitted `.js`, matching what Node actually needs to resolve at runtime.
- **TypeScript project references**, not `paths`-based aliasing to source. Each package's
  `tsconfig.json` sets `"composite": true` and lists a `references` entry per workspace
  dependency (e.g. `packages/core/tsconfig.json` references `../protocol`). A root
  `tsconfig.json` (`"files": []`) references every project so `tsc -b` (or an editor) can
  build/check the whole graph in dependency order.
- Both the `build` and `typecheck` npm scripts run **`tsc -b tsconfig.json`** (not `tsc
--noEmit`). This was a correction made during Phase 1 validation: `tsc --noEmit -p
<composite project with references>` produced `TS6305` errors ("output file has not
  been built from source") because, contrary to initial assumption, plain non-build-mode
  invocations did not reliably use TypeScript's project-reference "source redirect" here.
  `tsc -b` builds referenced projects automatically, in the correct order, incrementally
  (via `.tsbuildinfo`), and resolves this cleanly — at the cost of `typecheck` also
  producing build output, which is an accepted, minor overlap with `build`.
- Each package's `package.json` declares `"exports"` exposing **only** `.` and
  `./package.json` (no wildcard subpath exports), with `"main"`/`"types"` pointing at
  `dist/index.js` / `dist/index.d.ts`. This is both a publish-readiness step and a
  structural enforcement of "no deep imports across package boundaries" (see ADR 0002).
- All four SDK packages are `"private": true` for Phase 1 — nothing is published to npm
  yet (Phase 1 spec, Section 39: "Do not publish anything during Phase 1").

## Consequences

- A future real npm publish only needs to flip `"private"` to `false` (or remove it) and
  add publish-specific metadata (license, repository, etc.) — the entry-point shape doesn't
  need to change.
- Vitest is configured with its own resolution aliases (`tools/vitest.shared.ts`) mapping
  each `@gixcopilot/*` specifier straight to that package's `src/index.ts`, so `pnpm test`
  never requires `pnpm build` to have run first, independent of the TypeScript project-
  reference mechanism used for `tsc`.
- If a consumer ever needs CJS (e.g., an older tool that can't load ESM), that's a new,
  explicit decision requiring dual-build tooling — deliberately not pre-built here.

## Alternatives Considered

- **`tsconfig` `paths` aliasing straight to each package's `src/index.ts`.** Tried first;
  rejected after hitting `TS6059` ("file is not under 'rootDir'") once a package's `rootDir`
  was set explicitly, which is required for clean `outDir` structure. Project references
  avoid this because cross-project resolution is handled by the reference/redirect
  mechanism instead of a raw path substitution.
- **Dual ESM+CJS output** (e.g. via a bundler or `tsc` run twice with different configs).
  Rejected per the spec's explicit "don't overcomplicate" guidance and because nothing in
  this workspace consumes CJS.
