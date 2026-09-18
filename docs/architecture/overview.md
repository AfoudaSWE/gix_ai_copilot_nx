# Architecture Overview — Phase 1

## Request Flow

```text
Client
 |
 |  createCopilotClient({ baseUrl }).run({ message })
 v
Transport (CopilotTransport)
 |
 |  fetch POST /runs, Accept: text/event-stream
 v
Server (@aicopilot/server, Fastify)
 |
 |  validates body (Zod) -> runtime.run({ message })
 v
Core (@aicopilot/core)
 |
 |  createRuntime({ executor }) drives one Run
 v
Executor (generic run/execution boundary)
 |
 |  yields text deltas (createEchoExecutor for Phase 1 - not an LLM)
 v
Core translates deltas into CopilotEvents
 |
 |  run.started, message.started, message.delta*, message.end, run.completed
 v
Server serializes each event and writes an SSE frame
 |
 v
Client parses the SSE stream back into typed, validated CopilotEvents
```

No LLM is involved anywhere in this flow. The `Executor` interface in `@aicopilot/core` is
the seam where a real model integration will attach in Phase 2 — see the `ai-runtime`
skill.

## Package Responsibilities

| Package                  | Responsibility                                                                             | Must never depend on                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `@aicopilot/protocol`    | Wire contracts (`Message`, `Thread`, `Run`, `CopilotEvent`), validation, (de)serialization | anything else in the workspace                                                        |
| `@aicopilot/core`        | Run lifecycle, event sequencing, cancellation, the `Executor` boundary                     | Fastify, any LLM provider, `@aicopilot/server`, `@aicopilot/client`, any UI framework |
| `@aicopilot/server`      | HTTP/SSE adapter: validation, run creation, streaming, cancellation, error mapping         | any UI framework; must not embed executor/AI logic itself (it's injected)             |
| `@aicopilot/client`      | Framework-independent streaming client, transport abstraction                              | `@aicopilot/server`, React, Angular                                                   |
| `examples/protocol-demo` | Proves the full stack end to end with a deterministic executor                             | — (may depend on everything above)                                                    |

## Dependency Direction

```text
@aicopilot/protocol
        ^       ^
        |       |
   @aicopilot/  @aicopilot/core
   client              ^
                        |
                  @aicopilot/server
```

Enforced two ways:

1. **Structurally**, via each package's `exports` field exposing only `.` — a deep import
   into another package's `src/` cannot resolve, at either the TypeScript or the Node.js
   module-resolution level.
2. **By lint rule**, via `@nx/enforce-module-boundaries` in `eslint.config.js`, using tags
   (`scope:protocol`, `scope:core`, `scope:client`, `scope:server`, `scope:example`) and
   explicit `depConstraints`. A `protocol -> core` import, for example, is rejected at lint
   time (verified manually during Phase 1 validation by introducing exactly that import and
   confirming `eslint` fails on it).

This is the Phase 1 slice of the long-term target architecture:

```text
Framework SDKs (React, Angular)         <- Phase 3, 12
      |
Client SDK                              <- @aicopilot/client (this phase)
      |
Protocol                                <- @aicopilot/protocol (this phase)
      |
Server                                  <- @aicopilot/server (this phase)
      |
Core Runtime                            <- @aicopilot/core (this phase)
      |
Agents / Context / Tools                <- Phase 4, 5, 10
      |
Adapters (LLM providers, DB, MCP, ...)  <- Phase 2, 8, 9
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
  (`@nx/js`, `@nx/vite`, etc.) that isn't needed at this phase's scale — see
  [ADR 0001](../adr/0001-monorepo-and-package-boundaries.md).

## Known Phase 1 Limitations

Disclosed rather than hidden, per the code-review skill:

- Each package's `tsconfig.json` includes its own `*.spec.ts` files in the same compiled
  program as its source, so `dist/` currently also contains compiled test files. Splitting
  build/typecheck configs to exclude tests from `dist/` is deferred — it doesn't affect
  correctness (nothing outside `.` is ever importable per the `exports` field) but is
  slightly wasteful for an eventual npm-publish step.
- The server's run registry (`@aicopilot/server`'s `createRunRegistry`) is in-memory and
  process-local; it does not survive a restart and does not coordinate across multiple
  server instances.
- IDs (`RunId`, `ThreadId`, etc.) are plain `string` aliases, not nominally-branded types —
  see the comment in `packages/protocol/src/ids.ts` for why branding was tried and dropped.
