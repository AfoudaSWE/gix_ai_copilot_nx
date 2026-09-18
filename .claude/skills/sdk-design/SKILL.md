---
name: sdk-design
description: Rules for developer-facing SDK API design - simple defaults, progressive disclosure, headless APIs, composability, cancellation, and backward compatibility. Load when designing any public function, class, hook, or config surface.
---

# Purpose

Ensure every developer-facing API in the SDK is easy to start with, scales to advanced use
cases without a rewrite, and stays stable across releases.

# When to Apply

Designing or changing any public API: exported functions, classes, hooks, config objects,
or plugin/extension points.

# Required Rules

- Simple defaults: the common case must work with minimal required configuration; advanced
  options are optional and additive, never required to reach a working baseline.
- Progressive disclosure: expose a low-level, headless API (no UI/opinions) alongside any
  higher-level convenience API built on top of it — never only the high-level one.
- Composability over configuration explosion: prefer small composable functions/hooks over
  a single API with a dozen boolean flags.
- Every stable public API has a typed configuration object, not positional booleans or
  stringly-typed options.
- Extension points (adapters, plugins, middleware) are defined as explicit interfaces the
  core accepts, not as monkey-patchable internals.
- Errors thrown across a public API boundary are typed and documented (see
  [[typescript-standards]]) — never a bare string throw.
- Async APIs return promises or async iterables with clear cancellation support (e.g.
  `AbortSignal`) for anything that can run long (streaming, tool execution, agent runs).
- Lifecycle APIs (start/stop, subscribe/unsubscribe, connect/disconnect) always pair
  acquisition with an explicit release/cleanup path — no API that leaks a resource if the
  caller doesn't know to call an undocumented cleanup method.
- Public packages minimize their own dependencies; anything optional is an adapter (see
  [[dependency-policy]]) so consumers aren't forced to bundle unused code (tree-shaking is
  preserved).
- A public API, once released, is a compatibility contract — see [[backward-compatibility]]
  before changing a signature, return shape, or default value.

# Architecture / Patterns

- Headless core + opinionated layer: e.g. a framework-agnostic `runCopilot()` core function,
  with `useCopilot()` (React) and an Angular service as thin adapters over it — no logic
  duplicated in the adapters (see [[react-sdk]], [[angular-sdk]]).
- Config objects use sensible, documented defaults and accept partial overrides
  (`Partial<Config>` merged with defaults), validated with Zod at the boundary.
- Cancellation is threaded through every layer that can be slow: model calls, tool
  execution, agent runs, RAG retrieval — a caller can always cancel.

# Anti-Patterns

- A hook or function with 10+ independent boolean options instead of composable primitives.
- Shipping only a high-level React component with no way to access the underlying headless
  state/logic.
- A public method that has no way to cancel a multi-second operation.
- Silently changing a default value in a minor version release.

# Validation Checklist

- [ ] Common case works with minimal config; advanced options are optional
- [ ] A headless/low-level API exists beneath any high-level convenience API
- [ ] Config is a typed, validated object, not scattered positional args
- [ ] Long-running operations accept cancellation
- [ ] Public API change was checked against [[backward-compatibility]]
