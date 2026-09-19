# Architecture Overview — Phase 5

Phase 3 added the client-side layers below the Phase 1–2 flow; Phase 4 added
`@gixcopilot/context` beneath React; Phase 5 adds `@gixcopilot/tools` as a second leaf
package (alongside `context`), consumed by both `server` and `react`:

```text
                         Protocol
                        /        \
                    Client       Core
                      ^          ^  ^
                      |          |  Model Runtime <- Providers
               @gixcopilot/react |       ^
                   ^  ^    ^     Server -+---- @gixcopilot/tools (protocol only - no React/
                   |  |    |       ^              Fastify/provider SDK)
                   |  |    |       |
                   |  |    @gixcopilot/tools (backend tools, via toolRegistry)
                   |  @gixcopilot/context (protocol only - no React)
                   |  @gixcopilot/tools (frontend tools, via useFrontendTool)
                   |
               Custom UI   @gixcopilot/ui
                             /   |   \
                           Chat Popup Sidebar
```

Dependency arrows point toward consumers above: UI depends on React; React on Client,
Protocol, Context, and (Phase 5) Tools; Server on Core, Provider, Protocol, and (Phase 5)
Tools. Core still has no provider/framework dependency, and gained only one additive,
optional field (`ExecutorContext.onToolEvent`) — see
[Phase 5 Architecture](../phases/phase-05/Phase_5_Architecture.md) and
[ADR 0010](../adr/0010-canonical-tool-architecture.md). The server composes the core,
model-runtime, and tool-runtime interfaces; provider adapters implement the model-runtime
interface. `@gixcopilot/context` and `@gixcopilot/tools` are both framework-independent and
have no dependency on React or each other — see
[Phase 4 Architecture](../phases/phase-04/Phase_4_Architecture.md) and
[ADR 0009](../adr/0009-context-and-state-architecture.md) for the context pipeline.

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
| `@gixcopilot/react`           | Headless chat hooks (Phase 3) plus `useCopilotContext`/`useCopilotState` (Phase 4) and `useFrontendTool`/`useToolCalls` (Phase 5), bridging resolved context/tools into `client.run()` | any non-React/UI-adjacent business logic duplicated from `client`/`context`/`tools`                               |
| `examples/react-context`      | Proves Phase 4's context/state engine end to end with a deterministic, non-network context-aware provider                                       | — (may depend on everything above)                                                                                |
| `@gixcopilot/tools`           | Framework-independent canonical tool architecture: `ToolDefinition`/`defineTool`, registry, discovery resolver, execution runtime (validate/timeout/cancel/execute/serialize) | React, Angular, Fastify, any provider SDK, `@gixcopilot/core`/`client`                                            |
| `examples/react-tools`        | Proves Phase 5's backend/frontend tool loop, context + tool, tool error, and tool cancellation end to end with a deterministic, non-network provider | — (may depend on everything above)                                                                                |

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

   @gixcopilot/react ----> @gixcopilot/client, @gixcopilot/protocol, @gixcopilot/context, @gixcopilot/tools
```

Enforced two ways:

1. **Structurally**, via each package's `exports` field exposing only `.` — a deep import
   into another package's `src/` cannot resolve, at either the TypeScript or the Node.js
   module-resolution level.
2. **By lint rule**, via `@nx/enforce-module-boundaries` in `eslint.config.js`, using tags
   (`scope:protocol`, `scope:core`, `scope:client`, `scope:server`, `scope:provider`,
   `scope:provider-adapter`, `scope:context`, `scope:tools`, `scope:react`, `scope:ui`,
   `scope:example`) and explicit `depConstraints`. Verified manually each phase by
   introducing a forbidden import (e.g. `protocol -> core` in Phase 1, `provider-mock ->
   provider-openai` in Phase 2, `tools -> react` in Phase 5) and confirming `eslint` rejects
   it, then reverting.

The backend above remains the Phase 1+2 slice of the long-term architecture. React is
implemented (Phase 3); Context/state is implemented (Phase 4); Tools is implemented
(Phase 5); Angular, OpenAPI/MCP-derived tools, Agents, and subsequent capabilities remain
unimplemented:

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
Agents / Context / Tools                <- @gixcopilot/context (Phase 4); @gixcopilot/tools
                                            (Phase 5, this phase - native + frontend sources
                                            only; OpenAPI/MCP sources: Phase 8); Agents: Phase 10
      |
Adapters (LLM providers, DB, MCP, ...)  <- @gixcopilot/provider(-mock|-openai) (Phase 2), Phase 8, 9
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
