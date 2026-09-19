# 0010 — Canonical Tool Architecture

## Status

Accepted (Phase 5).

## Context

Phase 5's stated mission is to give the Copilot the ability to act: call backend
capabilities and drive browser-side behavior, through one architecture that later phases
(OpenAPI-to-tool generation, MCP, an Action Firewall, permission-aware discovery) can extend
without a redesign. Several architectural questions had to be settled before writing code:
where does a new tools package sit relative to `protocol`/`core`/`provider`/`server`/`react`;
how does a tool call reach a real model request and a real execution without a provider SDK
type leaking into core; how does a *frontend*-executed tool call cross the network without
faking its execution server-side; and how does the existing text-only `Executor` boundary
carry tool lifecycle information without becoming a breaking change.

## Decision

- **New package `@gixcopilot/tools`, depending only on `@gixcopilot/protocol` (+ `zod`).**
  Not on React, not on Fastify, not on any provider SDK, not on `@gixcopilot/core`. Backend
  tool execution logic lives in `@gixcopilot/server` (which already depends on `core` +
  `provider` + `tools`); frontend tool execution logic lives in `@gixcopilot/react` (which
  already depends on `client` + `context`, and now `tools`). Enforced by
  `@nx/enforce-module-boundaries` (`scope:tools` → `protocol, tools` only).
- **Tool identity is a single namespaced dot-name** (e.g. `applications.getStatus`), not a
  separate `namespace` + `name` pair. One field, one source of truth; the leading segment(s)
  are the "namespace" by convention (`toolNamespaceOf()`).
- **`ToolDefinition.execute` is declared with method shorthand, not a property function
  type.** This makes TypeScript check its parameter bivariantly, which is what lets a
  `ToolDefinition<Specific, Specific>` be stored in a registry's `AnyToolDefinition`
  collection without an `any`/unsafe-cast — a plain property-typed `execute` makes this
  fail to compile under `strictFunctionTypes` (contravariant parameter checking on a
  generic collection of differently-typed items). `defineTool()`'s own public signature is
  unaffected and remains fully strict.
- **Duplicate tool registration is rejected by default**; `{ replace: true }` opts in
  explicitly. A silent replace-on-duplicate default was rejected as a likely source of
  "which implementation actually ran" bugs; `useFrontendTool` always passes
  `{ replace: true }` since its own StrictMode-safe register/dispose lifecycle already
  guarantees at most one live registration per name at a time.
- **`ToolResolver` is a mandatory discovery indirection.** No call site anywhere in the
  codebase wires `registry.list()` directly into a model request; every path goes through a
  resolver (`createDefaultToolResolver`, `createStaticToolResolver`, or
  `combineToolResolvers`). This is the exact seam Phase 7 needs for permission-aware
  filtering and Phase 8 needs for OpenAPI/MCP-backed discovery, with zero change to the
  registry or runtime.
- **`ExecutorContext` gains an optional `onToolEvent` callback; `Executor.execute()`'s yield
  type stays `string`.** The alternative — widening the yield to a union of text/tool-event
  — would have touched every Phase 1/2 `Executor` implementation's type signature
  (`createEchoExecutor` included) for a capability only a tool-calling executor needs.
  Instead, `@gixcopilot/core`'s `runtime.ts` queues whatever a tool-calling executor reports
  through this new, optional field and drains it into real `tool.*` `CopilotEvent`s at its
  own next natural resumption point — the same additive-extension pattern Phase 2 used for
  `ExecutorCompletion`'s `usage`/`finishReason` fields.
- **The entire backend Model → Tool → Model loop happens inside one `Executor.execute()`
  call**, not as a new `RunStatus`. A tool round trip that only ever executes server-side has
  no reason to change the run's lifecycle state machine; it is simply `running` throughout,
  exactly as before Phase 5.
- **A frontend tool call suspends the same `execute()` call on a `FrontendToolBridge`
  promise** (correlated by `runId` + `toolCallId`), resolved by the client's
  `POST /runs/:runId/tool-results`, the run's own cancellation, or a configurable timeout —
  rather than inventing a new paused `RunStatus`/resume protocol message. This keeps the
  wire protocol's `CopilotEvent` union as the only new surface area (four `tool.*` variants)
  and reuses the existing `AbortSignal`/timeout machinery instead of building parallel ones.
- **The tool-calling executor `yield`s an empty string as a deliberate flush point** before
  any blocking dispatch (see Consequences) rather than restructuring `@gixcopilot/core`'s
  drain timing or giving `ExecutorContext.onToolEvent` its own delivery guarantee. An empty
  delta is suppressed by `runtime.ts` rather than reaching the wire as a no-op
  `message.delta` — the mechanism is fully internal.
- **Tool result payloads are validated on both sides of a frontend round trip.** The
  browser's own `ToolRuntime.execute()` re-validates the model's arguments against the
  registered tool's Zod schema before running `execute()`, exactly as the server does for a
  backend tool — the model's output is never trusted more on one side of the network than
  the other (security skill's zero-trust rule).
- **Structured outputs (`generateObject`) are a distinct API from tool calling**, living in
  `@gixcopilot/provider` (built on `ModelRuntime.stream()`), not layered on top of the tool
  runtime — a tool has a name the model chooses to invoke mid-conversation; `generateObject`
  is the caller directly asking for one JSON value with no round trip.

## Consequences

- No protocol version bump was required in the sense of removing/renaming anything; every
  addition (new `ContentPart` variants, new `CopilotEvent` variants, new `CopilotErrorCode`
  values, new `FinishReason` value) is purely additive and covered by `parseEvent`'s existing
  forward-compatibility contract for an older client encountering a newer event type.
- A request that declares no tools and points at a server with no `toolRegistry` configured
  is provably behaviorally identical to pre-Phase-5 behavior (same executor,
  `createModelExecutor`) — verified by test, not merely assumed.
- Widening `ContentPart` did require a mechanical fix (a `.filter(part => part.type ===
  'text')` narrowing helper) at five pre-existing call sites that assumed `ContentPart` had
  exactly one shape. This is disclosed in [Testing](../phases/phase-05/Phase_5_Testing.md) as
  a real, if small, backward-compatibility cost of the additive union — every fix preserves
  prior behavior exactly (those call sites only ever saw text parts before Phase 5 existed).
- A genuine concurrency bug in `@gixcopilot/core`'s event-draining logic (tool events queued
  just before a thrown error were silently lost) and a genuine deadlock (a frontend tool
  call's `tool.requested` event never reaching the wire before the executor blocked awaiting
  the client's response) were both found and fixed as a direct result of writing real,
  cross-package integration tests rather than only unit-testing each package in isolation —
  see [Testing](../phases/phase-05/Phase_5_Testing.md) for the full account.
- Tool metadata (`riskClass`, `sensitivity`, `concurrency`, `custom`) is classification-only
  in Phase 5; nothing reads it as an authorization decision. A future Phase 7 middleware can
  consume it, but no code path today treats a metadata value as license to skip a check that
  doesn't yet exist.

## Alternatives Considered

- **Widening `Executor.execute()`'s yield type to a discriminated union** (`{kind:'text',
  delta} | {kind:'tool-event', event}`) instead of adding `ExecutorContext.onToolEvent`.
  Rejected: it would have required updating every existing `Executor` implementation's type
  signature and every call site that consumes one, for a capability specific to tool-calling
  executors — the additive-context-field approach achieves the same interleaving with zero
  changes to `createEchoExecutor` or any Phase 1/2 test.
- **A new `RunStatus` (e.g. `'awaiting_tool'`) for a paused frontend tool round trip.**
  Rejected: it would require updating `RunLifecycle.allowedTransitionsFrom`'s exhaustive
  switch, every consumer that switches on `RunStatus`, and the wire protocol's `Run` schema,
  for a pause that already has a working mechanism (an `await` inside one executor call plus
  the existing `AbortSignal`). Revisit only if a future phase needs a *client* (not just the
  server) to observe "this run is currently paused for a tool" as first-class state
  independent of the tool events themselves.
- **Executing a frontend tool call directly server-side using data sent up front** (e.g. the
  client pre-registers a serialized "policy" the server evaluates) to avoid the network round
  trip entirely. Rejected outright — Section 45 is explicit that faking frontend execution
  server-side defeats the entire point of a frontend tool (only the browser can navigate,
  read DOM/local state, or call browser-only APIs on the user's behalf).
- **A single global tool registry** instead of one owned by the server app author (backend)
  and one per `CopilotProvider` instance (frontend). Rejected: it would prevent multiple
  independent `CopilotProvider`s (Phase 4's ADR 0009 precedent) from having different
  frontend tools available, and would make testing (which needs fully isolated registries per
  test) significantly harder.
