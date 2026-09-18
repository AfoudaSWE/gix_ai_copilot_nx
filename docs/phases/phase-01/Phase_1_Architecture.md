# Phase 1 Architecture

See `docs/architecture/overview.md` for the full, current (Phase 1+2) architecture
document. This file reproduces the Phase 1-specific diagrams as they were when Phase 1
was completed, before the model runtime existed.

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
Server (@gixcopilot/server, Fastify)
 |
 |  validates body (Zod) -> runtime.run({ message })
 v
Core (@gixcopilot/core)
 |
 |  createRuntime({ executor }) drives one Run
 v
Executor (generic run/execution boundary)
 |
 |  yields text deltas (createEchoExecutor - not an LLM)
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

No LLM is involved anywhere in this flow — proving the architecture was Phase 1's entire
purpose. The `Executor` interface in `@gixcopilot/core` was deliberately designed as the
seam a real model integration would attach to later (which Phase 2 then did — see
`docs/adr/0006-model-provider-abstraction.md`).

## Package Responsibilities (as of Phase 1 completion)

| Package                  | Responsibility                                                                             | Must never depend on                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `@gixcopilot/protocol`   | Wire contracts (`Message`, `Thread`, `Run`, `CopilotEvent`), validation, (de)serialization | anything else in the workspace                                                          |
| `@gixcopilot/core`       | Run lifecycle, event sequencing, cancellation, the `Executor` boundary                     | Fastify, any LLM provider, `@gixcopilot/server`, `@gixcopilot/client`, any UI framework |
| `@gixcopilot/server`     | HTTP/SSE adapter: validation, run creation, streaming, cancellation, error mapping         | any UI framework; must not embed executor/AI logic itself (it's injected)               |
| `@gixcopilot/client`     | Framework-independent streaming client, transport abstraction                              | `@gixcopilot/server`, React, Angular                                                    |
| `examples/protocol-demo` | Proves the full stack end to end with a deterministic executor                             | — (may depend on everything above)                                                      |

## Dependency Direction

```text
@gixcopilot/protocol
        ^       ^
        |       |
   @gixcopilot/  @gixcopilot/core
   client              ^
                        |
                  @gixcopilot/server
```

Enforced structurally (each package's `exports` field exposes only `.`) and by lint rule
(`@nx/enforce-module-boundaries` in `eslint.config.js`), verified during Phase 1 validation
by deliberately introducing a `protocol -> core` import and confirming `eslint` rejected it.

## Module Resolution & Build Strategy

TypeScript project references (not path-alias-to-source mapping), ESM-only with NodeNext
`.js`-extension imports, and `tsc -b` for both the `build` and `typecheck` targets — the
full reasoning, including the alternative that was tried and rejected, is in
`docs/adr/0005-module-resolution-and-build-strategy.md`.
