# Architecture Overview — Phase 2

## Request Flow

Two paths exist side by side, selected by whether the request names a `model`:

```text
Client
 |
 |  createCopilotClient({ baseUrl }).run({ model?, messages })
 v
Transport (CopilotTransport)
 |
 |  fetch POST /runs, Accept: text/event-stream
 v
Server (@gixcopilot/server, Fastify)
 |
 |  validates body (Zod)
 |
 +-- no `model` field -----------------> options.runtime.run({ messages })     (Phase 1 path)
 |
 +-- `model` field present ------------> createModelExecutor({ runtime: modelRuntime, model })
                                          then createRuntime({ executor }).run({ messages })
                                                     |
                                                     v
                                          Model Runtime (@gixcopilot/provider)
                                                     |
                                                     |  provider lookup, timeout, retry, latency
                                                     v
                                          ModelProvider (mock | openai | ...)
                                                     |
                                                     |  raw provider chunk
                                                     v
                                          Provider Adapter normalizes to ModelStreamEvent
                                                     |
                                                     |  content.delta / usage.updated / model.completed
                                                     v
                                          createModelExecutor yields text deltas + ExecutorCompletion
                                                     |
                                                     v
Core (@gixcopilot/core) - createRuntime({ executor }) drives one Run either way
 |
 |  translates executor output into CopilotEvents
 |  run.started, message.started, message.delta*, message.end,
 |  run.completed (usage + optional finishReason), run.failed, run.cancelled
 v
Server serializes each event and writes an SSE frame
 |
 v
Client parses the SSE stream back into typed, validated CopilotEvents
```

`@gixcopilot/core` never learns which path it's on — both paths hand it the same `Executor`
shape, per `docs/adr/0002-framework-independent-core.md` and
`docs/adr/0006-model-provider-abstraction.md`.

## Package Responsibilities

| Package                       | Responsibility                                                                                                                                  | Must never depend on                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `@gixcopilot/protocol`        | Wire contracts (`Message`, `Thread`, `Run`, `CopilotEvent`, `FinishReason`), validation, (de)serialization                                      | anything else in the workspace                                                                                    |
| `@gixcopilot/core`            | Run lifecycle, event sequencing, cancellation, the `Executor` boundary                                                                          | Fastify, any LLM provider or `@gixcopilot/provider`, `@gixcopilot/server`, `@gixcopilot/client`, any UI framework |
| `@gixcopilot/provider`        | Provider-neutral model contracts, registry, `ModelRuntime` (retry/timeout/cancellation/usage/latency), `createModelExecutor` bridge into `core` | any concrete provider SDK, `@gixcopilot/server`, `@gixcopilot/client`, any UI framework                           |
| `@gixcopilot/provider-mock`   | Deterministic, non-network `ModelProvider` for tests/examples/CI                                                                                | any other provider adapter                                                                                        |
| `@gixcopilot/provider-openai` | OpenAI streaming `ModelProvider`; the only package allowed to depend on the `openai` SDK                                                        | any other provider adapter                                                                                        |
| `@gixcopilot/server`          | HTTP/SSE adapter: validation, run creation (default or model-backed), streaming, cancellation, error mapping                                    | any UI framework, any concrete provider adapter; must not embed executor/AI logic itself (injected)               |
| `@gixcopilot/client`          | Framework-independent streaming client, transport abstraction, opaque `model` pass-through                                                      | `@gixcopilot/server`, `@gixcopilot/provider`, React, Angular                                                      |
| `examples/protocol-demo`      | Proves the Phase 1 stack end to end with a deterministic executor                                                                               | — (may depend on everything above)                                                                                |
| `examples/model-streaming`    | Proves the Phase 2 model runtime end to end, mock by default, optional real OpenAI                                                              | — (may depend on everything above)                                                                                |

## Dependency Direction

```text
                         @gixcopilot/protocol
                         ^   ^    ^      ^
                         |   |    |      |
   @gixcopilot/client ----+   |    |      +---- @gixcopilot/provider
                             |    |                ^        ^
                     @gixcopilot/core                |        |
                             ^                       |        |
                             |                        |        |
                       @gixcopilot/server -------------+        |
                                                                 |
                                        @gixcopilot/provider-mock, @gixcopilot/provider-openai
                                        (each depends on @gixcopilot/provider + protocol only,
                                         never on each other)
```

Enforced two ways:

1. **Structurally**, via each package's `exports` field exposing only `.` — a deep import
   into another package's `src/` cannot resolve, at either the TypeScript or the Node.js
   module-resolution level.
2. **By lint rule**, via `@nx/enforce-module-boundaries` in `eslint.config.js`, using tags
   (`scope:protocol`, `scope:core`, `scope:client`, `scope:server`, `scope:provider`,
   `scope:provider-adapter`, `scope:example`) and explicit `depConstraints`. Verified
   manually each phase by introducing a forbidden import (e.g. `protocol -> core` in
   Phase 1, `provider-mock -> provider-openai` in Phase 2) and confirming `eslint` rejects
   it, then reverting.

This is the Phase 1+2 slice of the long-term target architecture:

```text
Framework SDKs (React, Angular)         <- Phase 3, 12
      |
Client SDK                              <- @gixcopilot/client
      |
Protocol                                <- @gixcopilot/protocol
      |
Server                                  <- @gixcopilot/server
      |
Core Runtime                            <- @gixcopilot/core
      |
Agents / Context / Tools                <- Phase 4, 5, 10
      |
Adapters (LLM providers, DB, MCP, ...)  <- @gixcopilot/provider(-mock|-openai) (this phase), Phase 8, 9
```

## Module Resolution & Build Strategy

- **ESM only.** Every package is `"type": "module"`, targets `NodeNext` module/resolution,
  and uses `.js` extensions in relative import specifiers (resolving to the sibling `.ts`
  file at compile time, matching the emitted `.js` at runtime) — the standard TypeScript
  NodeNext convention. No CJS build is produced; see
  [ADR 0005](../adr/0005-module-resolution-and-build-strategy.md).
- **TypeScript project references**, not path-alias-to-source mapping. Each package is a
  `composite` TypeScript project; a dependent package's `tsconfig.json` lists a
  `references` entry for each workspace dependency. This lets `tsc -b` build the graph in
  the correct order and lets a one-shot `tsc -b` (used for both the `build` and
  `typecheck` targets) resolve a dependency's types correctly whether or not it has been
  built yet, via TypeScript's project-reference source redirect.
- **Nx** orchestrates and caches `lint` / `typecheck` / `test` / `build` per project
  (`nx.json` + each package's `project.json`), without relying on a heavier plugin stack
  (`@nx/js`, `@nx/vite`, etc.) — see [ADR 0001](../adr/0001-monorepo-and-package-boundaries.md).
- Provider packages live under `packages/providers/*` (a nested workspace glob,
  `packages/providers/*`, added alongside `packages/*` in `pnpm-workspace.yaml`) to keep
  them visually grouped as a family, per Section 6's suggested layout.

## Known Limitations

Disclosed rather than hidden, per the code-review skill:

- Each package's `tsconfig.json` includes its own `*.spec.ts` files in the same compiled
  program as its source, so `dist/` currently also contains compiled test files. Deferred
  cleanup — doesn't affect correctness (nothing outside `.` is ever importable per the
  `exports` field), slightly wasteful for an eventual npm-publish step.
- The server's run registry (`@gixcopilot/server`'s `createRunRegistry`) is in-memory and
  process-local; it does not survive a restart and does not coordinate across multiple
  server instances.
- IDs (`RunId`, `ThreadId`, etc.) are plain `string` aliases, not nominally-branded types —
  see the comment in `packages/protocol/src/ids.ts` for why branding was tried and dropped.
- **(Phase 2)** Model selection is static configuration (`defaultProvider`/`defaultModel`
  or a per-request `model` field) — there is no intelligent routing, cost-aware model
  selection, or automatic multi-provider fallback (explicitly out of scope; Section 35/36).
- **(Phase 2)** `ModelRuntime`'s retry backoff uses real (not virtual/fake) timers; tests
  keep this fast by setting `baseDelayMs`/`maxDelayMs` to `0` rather than by mocking time.
