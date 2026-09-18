---
name: typescript-standards
description: Strict TypeScript engineering rules for the AI Copilot SDK - strict mode, type safety, discriminated unions, exhaustive switches, naming, and public API stability. Load whenever writing or reviewing TypeScript code.
---

# Purpose

Define enforceable TypeScript rules so code across every package (core, adapters, SDKs) is
consistently strict, type-safe, and safe to consume as a public API.

# When to Apply

Any time TypeScript source is written, edited, or reviewed in this project.

# Required Rules

- `strict: true` (and all strict-family flags) is mandatory in every package's `tsconfig`.
  No package may opt out.
- `any` is not allowed in committed code. Use `unknown` and narrow explicitly, or a properly
  typed generic. A rare, justified exception requires an inline comment explaining why and
  a link to the constraint forcing it.
- Every exported function, class, and type must have an explicit, hand-authored public type
  — do not rely solely on inference for anything crossing a package boundary.
- Model discriminated state (tool call status, run status, message roles, approval state)
  as discriminated unions with a literal `kind`/`type` tag, not boolean flags or optional
  field combinations.
- `switch` statements over a union or enum must be exhaustive; use a `never`-typed
  assertion in the `default` case so new union members fail to compile until handled.
- Prefer immutable data structures for anything shared across async boundaries (events,
  context snapshots, tool results). Use `readonly` and `Readonly<T>` on public shapes.
- Errors are typed: define specific error classes/discriminated error unions per domain
  (e.g. `ToolExecutionError`, `ProtocolViolationError`) rather than throwing bare `Error` or
  strings across a public boundary.
- Use `import type` / `export type` for type-only imports and exports (`verbatimModuleSyntax`
  or equivalent enabled).
- No unsafe casts (`as any`, double-cast through `unknown`, non-null assertion `!`) without
  an inline comment justifying why the invariant holds.
- Naming: packages `@aicopilot/<name>` (kebab-case), types/interfaces PascalCase, functions/
  variables camelCase, constants intended as public contracts SCREAMING_SNAKE_CASE only for
  true constants (not config objects).
- Prefer `interface` for object shapes that may be extended or implemented by adapters;
  prefer `type` for unions, intersections, and mapped/conditional types.
- Every public package must export from a single, curated barrel (`index.ts`) — no deep
  imports into internal file paths from outside the package.
- Public API stability: a shipped public type/function signature is a compatibility
  contract — see [[backward-compatibility]] before changing one.
- Public-facing functions and types get a one-line TSDoc comment describing behavior/
  contract, not restating the name.

# Anti-Patterns

- `function handle(input: any): any { ... }` anywhere in a public API.
- Optional-boolean soup (`isLoading`, `isError`, `isDone` all independently optional) instead
  of a single discriminated status field.
- `catch (e) { throw e as MyError }` without validating `e` is actually that shape.
- Re-exporting a third-party provider SDK's types directly from a core package's public API.
- Deep-importing `@aicopilot/core/src/internal/foo` from another package.

# Validation Checklist

- [ ] No `any` introduced; `unknown` used and narrowed where type is not statically known
- [ ] Public exports have explicit types, not solely inferred
- [ ] State machines use discriminated unions with exhaustive handling
- [ ] Errors are typed domain errors, not bare `Error`/strings, at public boundaries
- [ ] No unsafe cast without a justifying comment
- [ ] `tsc --noEmit` passes with strict mode for every touched package
