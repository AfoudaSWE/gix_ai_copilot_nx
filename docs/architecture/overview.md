# Architecture Overview — Phase 6

Phase 3 added the client-side layers below the Phase 1–2 flow; Phase 4 added
`@gixcopilot/context` beneath React; Phase 5 added `@gixcopilot/tools` as a second leaf
package (alongside `context`), consumed by both `server` and `react`; Phase 6 adds
`@gixcopilot/generative-ui`, a third leaf package that itself depends on `tools` and
`context` (the only inter-leaf dependency in the graph):

```text
                         Protocol
                        /        \
                    Client       Core
                      ^          ^  ^
                      |          |  Model Runtime <- Providers
               @gixcopilot/react |       ^
                   ^  ^  ^  ^     Server -+---- @gixcopilot/tools (protocol only - no React/
                   |  |  |  |       ^              Fastify/provider SDK)
                   |  |  |  |       |
                   |  |  |  @gixcopilot/tools (backend tools, via toolRegistry)
                   |  |  @gixcopilot/context (protocol only - no React)
                   |  |  @gixcopilot/tools (frontend tools, via useFrontendTool)
                   |  @gixcopilot/generative-ui (protocol + tools + context - no React)
                   |
               Custom UI   @gixcopilot/ui
                             /   |   \
                           Chat Popup Sidebar
```

Dependency arrows point toward consumers above: UI depends on React; React on Client,
Protocol, Context, Tools (Phase 5), and (Phase 6) Generative-UI; Server on Core, Provider,
Protocol, and Tools. Core still has no provider/framework dependency, and gained only one
additive, optional field back in Phase 5 (`ExecutorContext.onToolEvent`) — **no
protocol/core/client/server/provider file was modified in Phase 6 at all**; see
[Phase 6 Architecture](../phases/phase-06/Phase_6_Architecture.md) and
[ADR 0011](../adr/0011-generative-ui-and-state-patch-architecture.md). The server composes
the core, model-runtime, and tool-runtime interfaces; provider adapters implement the
model-runtime interface. `@gixcopilot/context` and `@gixcopilot/tools` remain framework-
independent with no dependency on each other or React —
[Phase 4 Architecture](../phases/phase-04/Phase_4_Architecture.md)/
[ADR 0009](../adr/0009-context-and-state-architecture.md) and
[Phase 5 Architecture](../phases/phase-05/Phase_5_Architecture.md)/
[ADR 0010](../adr/0010-canonical-tool-architecture.md); `@gixcopilot/generative-ui` is also
framework-independent but *does* depend on both of them (it bridges a registered component
or a writable state slot into a reserved `@gixcopilot/tools` `ToolDefinition` — see
[ADR 0011](../adr/0011-generative-ui-and-state-patch-architecture.md)).

`@gixcopilot/react` supplies an isolated provider, immutable local chat snapshots and narrow
hooks. It consumes the client's public event stream and cancellation API.
`@gixcopilot/ui` supplies composable views, safe Markdown, theming and accessibility, and
depends only on React SDK workspace APIs. Custom UIs require no UI package. Nx enforces
`scope:react` → react/client/protocol and `scope:ui` → ui/react. The two React examples
compose this with the existing real HTTP/SSE stack and deterministic mock provider.

Full state/lifecycle diagrams and tradeoffs:
[Phase 3 Architecture](../phases/phase-03/Phase_3_Architecture.md),
[ADR 0007](../adr/0007-headless-react-state-and-lifecycle.md),
[ADR 0008](../adr/0008-copilot-ui-rendering-and-styling.md).

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
| `@gixcopilot/context`         | Framework-independent context registry/engine (scopes, priority, sensitivity, serialization, dedup, token budgeting/truncation) and shared state store | React, Angular, any provider SDK, `@gixcopilot/core`/`client`/`server`                                            |
| `@gixcopilot/react`           | Headless chat hooks (Phase 3) plus `useCopilotContext`/`useCopilotState` (Phase 4), `useFrontendTool`/`useToolCalls` (Phase 5), and `useGenerativeComponent`/`useToolRenderer`/`useInvokeTool` (Phase 6), bridging resolved context/tools/components into `client.run()` | any non-React/UI-adjacent business logic duplicated from `client`/`context`/`tools`/`generative-ui`               |
| `examples/react-context`      | Proves Phase 4's context/state engine end to end with a deterministic, non-network context-aware provider                                       | — (may depend on everything above)                                                                                |
| `@gixcopilot/tools`           | Framework-independent canonical tool architecture: `ToolDefinition`/`defineTool`, registry, discovery resolver, execution runtime (validate/timeout/cancel/execute/serialize) | React, Angular, Fastify, any provider SDK, `@gixcopilot/core`/`client`                                            |
| `examples/react-tools`        | Proves Phase 5's backend/frontend tool loop, context + tool, tool error, and tool cancellation end to end with a deterministic, non-network provider | — (may depend on everything above)                                                                                |
| `@gixcopilot/generative-ui`   | Framework-independent trusted component registry, the reserved-tool bridge that carries a structured UI request over the canonical tool-calling pipeline, the state-patch tool bridge, and progress mapping | React, Angular, Fastify, any provider SDK, `@gixcopilot/core`/`client`/`server`                                   |
| `examples/react-generative-ui`| Proves Phase 6's generative-UI/state-patch pipeline end to end: component rendering, interactive direct invocation, and the stale-revision conflict path, with a deterministic, non-network provider | — (may depend on everything above)                                                                                |

## Dependency Direction

```text
                         @gixcopilot/protocol
                         ^   ^    ^      ^     ^
                         |   |    |      |     |
   @gixcopilot/client ----+   |    |      +---- @gixcopilot/provider    @gixcopilot/tools
                             |    |                ^        ^                ^      ^
                     @gixcopilot/core                |        |               |      |
                             ^                       |        |               |      |
                             |                        |        |               |      |
                       @gixcopilot/server -------------+--------+---------------+      |
                             |                                                          |
                             +------------------------------------------------------------+
                                                                 |
                                        @gixcopilot/provider-mock, @gixcopilot/provider-openai
                                        (each depends on @gixcopilot/provider + protocol only,
                                         never on each other)

   @gixcopilot/generative-ui ----> @gixcopilot/protocol, @gixcopilot/tools, @gixcopilot/context

   @gixcopilot/react ----> @gixcopilot/client, @gixcopilot/protocol, @gixcopilot/context,
                            @gixcopilot/tools, @gixcopilot/generative-ui
```

Enforced two ways:

1. **Structurally**, via each package's `exports` field exposing only `.` — a deep import
   into another package's `src/` cannot resolve, at either the TypeScript or the Node.js
   module-resolution level.
2. **By lint rule**, via `@nx/enforce-module-boundaries` in `eslint.config.js`, using tags
   (`scope:protocol`, `scope:core`, `scope:client`, `scope:server`, `scope:provider`,
   `scope:provider-adapter`, `scope:context`, `scope:tools`, `scope:generative-ui`,
   `scope:react`, `scope:ui`, `scope:example`) and explicit `depConstraints`. Verified
   manually each phase by introducing a forbidden import (e.g. `protocol -> core` in
   Phase 1, `provider-mock -> provider-openai` in Phase 2, `tools -> react` in Phase 5,
   `generative-ui -> react` in Phase 6) and confirming `eslint` rejects it, then reverting.

The backend above remains the Phase 1+2 slice of the long-term architecture. React is
implemented (Phase 3); Context/state is implemented (Phase 4); Tools is implemented
(Phase 5); Generative UI & AI-writable state is implemented (Phase 6); Angular, OpenAPI/MCP-
derived tools, Agents, and subsequent capabilities remain unimplemented:

```text
Framework SDKs (React, Angular)         <- Phase 3 (React), 12 (Angular)
      |
Client SDK                              <- @gixcopilot/client
      |
Protocol                                <- @gixcopilot/protocol
      |
Server                                  <- @gixcopilot/server
      |
Core Runtime                            <- @gixcopilot/core
      |
Agents / Context / Tools / Generative UI <- @gixcopilot/context (Phase 4); @gixcopilot/tools
                                            (Phase 5 - native + frontend sources only;
                                            OpenAPI/MCP sources: Phase 8);
                                            @gixcopilot/generative-ui (Phase 6, this phase);
                                            Agents: Phase 10
      |
Adapters (LLM providers, DB, MCP, ...)  <- @gixcopilot/provider(-mock|-openai) (Phase 2);
                                            @gixcopilot/openapi, @gixcopilot/mcp,
                                            @gixcopilot/integrations (Phase 8);
                                            @gixcopilot/knowledge, @gixcopilot/rag,
                                            @gixcopilot/vectorstore-pgvector,
                                            @gixcopilot/memory (Phase 9)
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

## Phase 8 integration boundary

OpenAPI and MCP now generate canonical tools into the existing registry/runtime. They depend on tools/protocol, never on React, the server, each other or the security implementation. Host authentication, the Action Firewall and approval/data policies govern external execution; server calls fail closed without the firewall. The integration catalog is a separate host-owned metadata registry. See [Phase 8 architecture](../phases/phase-08/Phase_8_Architecture.md) for the current diagrams and supported boundaries; older phase snapshots above describe their implementation-time scope.

## Phase 9 integration boundary

`@gixcopilot/knowledge` (source/document/loader contracts; depends on protocol + mcp) ->
`@gixcopilot/rag` (chunking, embeddings, the storage-agnostic `VectorStore` contract,
permission-aware retrieval, reranking, citations; depends on protocol + security + knowledge,
never PostgreSQL) -> `@gixcopilot/vectorstore-pgvector` (the only package depending on
`drizzle-orm`/`pg`). `@gixcopilot/memory` (working/session/durable/semantic memory; depends on
protocol + security + rag) reuses rag's `EmbeddingProvider`/`VectorStore` for semantic memory in
a separate table rather than a second vector system. Neither `rag` nor `memory` depends on
`@gixcopilot/context` — both produce plain, duck-typed contributions the host registers into the
existing `ContextEngine`, and neither depends on `@gixcopilot/security`'s policy/firewall
machinery beyond `SecurityContext`/`Policy`/`DataPolicy` (no second authorization model).
`@gixcopilot/react`/`@gixcopilot/ui` do not depend on knowledge/rag/memory at all — citation UI
is duck-typed against plain data the host application supplies. See
[Phase 9 architecture](../phases/phase-09/Phase_9_Architecture.md) for the current diagrams and
supported boundaries; older phase snapshots above describe their implementation-time scope.
