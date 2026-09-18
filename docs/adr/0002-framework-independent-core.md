# 0002 — Framework-Independent Core

## Status

Accepted (Phase 1).

## Context

The project's stated long-term goal is a framework-independent enterprise SDK: React,
Angular, and every LLM provider must be adapters, never hard dependencies of the core (see
the `project-architecture` skill). Phase 1 is where this boundary is first drawn in real
code, not just described — get it wrong here and every later phase inherits the leak.

## Decision

- `@aicopilot/core` has exactly one workspace dependency: `@aicopilot/protocol`. It does
  not depend on Fastify, any LLM provider SDK, React, Angular, or any database/cache
  driver.
- The core's only integration point with the outside world is the `Executor` interface
  (`packages/core/src/executor.ts`): `execute(input, context): AsyncIterable<string>`.
  This is a deliberately generic "run/execution boundary," not a disguised LLM
  abstraction — it has no concept of a model, a prompt, temperature, or a provider. Phase
  2's `ai-runtime` skill owns the actual model abstraction, built as a _different_,
  additional layer that plugs into (or alongside) this same boundary.
- `@aicopilot/server` adapts this core to HTTP by **injecting** a `Runtime` (built from a
  core `Executor`) into `createServer({ runtime })` — the server never constructs its own
  executor or embeds any business/AI logic.
- `@aicopilot/client` has no dependency on `@aicopilot/server` or any UI framework; it only
  depends on `@aicopilot/protocol`.
- This boundary is checked both by `@nx/enforce-module-boundaries` (tags/depConstraints,
  see ADR 0001) and manually verified during Phase 1 validation by attempting a forbidden
  import (`@aicopilot/protocol` importing `@aicopilot/core`) and confirming lint rejects
  it.

## Consequences

- Phase 2 (LLM runtime) must introduce its provider abstraction as a _new_ package/layer
  built on top of (or beside) `Executor`, not by reaching into `@aicopilot/core` and adding
  provider-specific code to it.
- Phase 3 (React) and the future Angular SDK must each be a thin adapter over
  `@aicopilot/client`'s existing, already-framework-independent API — they must not
  duplicate run/streaming/cancellation logic.
- Testing the core requires no network, no provider credentials, and no browser — see
  `createEchoExecutor`, which exists specifically so `@aicopilot/core`'s own test suite (and
  the example app) can prove the runtime works without any of that.

## Alternatives Considered

- **Bake a "null" or "mock" LLM provider directly into `@aicopilot/core`** so later phases
  could "just swap it out." Rejected: this is exactly the kind of future-phase behavior
  hiding behind an abstraction that the `phase-gate` skill forbids — the interface is
  allowed to exist, but no model-shaped concept (prompts, roles-as-model-input, tokens- as-
  a-runtime-concern) belongs in it yet.
- **Let the server own the executor directly** (i.e., hardcode `createEchoExecutor()`
  inside `@aicopilot/server`). Rejected: this would make "no AI logic in the server" false
  and would make it impossible to run the server against a different executor (e.g., a
  future real model) without editing the server package itself.
