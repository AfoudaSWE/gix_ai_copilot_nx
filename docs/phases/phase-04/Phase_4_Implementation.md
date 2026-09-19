# Phase 4 Implementation

## `@gixcopilot/context` (new package)

Framework-independent. One workspace dependency: `@gixcopilot/protocol` (for `CopilotError`
only). No React, no provider SDK, no runtime dependency beyond that.

- `context-scope.ts` / `context-priority.ts` / `context-sensitivity.ts` — the three closed
  vocabularies (`ContextScope`, `ContextPriority`, `ContextSensitivity`), each with a
  runtime list/type-guard for anything that needs to validate an external value.
- `context-item.ts` — `CopilotContextItem<T>` (the stored shape), `ContextItemInput<T>` (what
  a caller registers), `ContextItemPatch<T>` (a partial update).
- `context-registry.ts` — `createContextRegistry()`: register/update/patch/remove/get/list/
  subscribe/clear, plus the `ContextRegistration<T>` handle (`update`/`patch`/`dispose`).
  Identity rule: an explicit `id` updates in place; an omitted `id` always creates a new item,
  even with a duplicate `name` (Section 18 — a deterministic, documented rule, not
  fuzzy/implicit name-based merging).
- `context-serializer.ts` — `createDefaultContextSerializer()`: the single controlled
  serialization boundary (see Architecture doc). No dependency on any tokenizer or DOM
  library — DOM-like values are detected by duck-typing (`'nodeType' in value`), not an
  `instanceof` check against a DOM class that wouldn't exist in Node.
- `token-estimator.ts` — `TokenEstimator` interface + `createDefaultTokenEstimator()` (a
  ~4-characters-per-token heuristic, explicitly documented as an approximation).
- `context-compressor.ts` — `ContextCompressor` interface + `createTruncatingCompressor()`
  (deterministic, estimator-driven iterative shrink — see Architecture doc's budgeting
  section for why and when the engine calls it).
- `context-format.ts` — `formatContextItemBlock()` / `joinContextBlocks()`: the single place
  that turns `(name, scope, description, serializedText)` into the `[Context: name] ...`
  block shown in the brief, and joins multiple blocks with a stable separator.
- `resolved-context.ts` — types only: `ResolvedContext`, `ResolvedContextItem`,
  `ContextExclusion`, `ContextExclusionReason`, `ContextDiagnostics`, `ContextInspection`.
- `context-engine.ts` — `createContextEngine(options)`: the pipeline described in the
  Architecture doc, plus `inspect()`.
- `state-store.ts` — `createCopilotStateStore()`: a small, typed, id-keyed store
  (`register`/`get`/`set`/`update`/`subscribe`/`remove`/`list`), with optional per-slot
  validation (`StateValidator<T>`) that rejects an invalid `set`/`update` by throwing
  `CopilotError.validation(...)`, leaving the stored value unchanged.

Every module above ships its own `*.spec.ts` (50 tests total) — see
[Testing](Phase_4_Testing.md).

## `@gixcopilot/react` (extended)

New files, no changes to the public shape of any Phase 3 export:

- `internals.ts` — `CopilotInternalsContext` (registry/engine/stateStore triple) +
  `useCopilotInternals()`. Internal only; not exported from `index.ts`.
- `context-hooks.ts` — `useCopilotContext()` and `useCopilotContextDebug()`.
- `state-hooks.ts` — `useCopilotState()`, composing `useCopilotContext()` internally for the
  `exposeToModel` bridge (see Architecture doc's state pipeline).

Modified files:

- `types.ts` — added `CopilotContextOptions` and an **optional** `context?:
  CopilotContextOptions` field on `CopilotProviderProps`. Purely additive; every existing
  Phase 3 `CopilotProviderProps` value remains valid.
- `provider.tsx` — `CopilotProvider` now also creates (once per provider instance, via
  `useMemo` keyed on `maxContextTokens`) a `ContextRegistry`, `ContextEngine`, and
  `CopilotStateStore`, provides them via `CopilotInternalsContext`, and builds a
  `resolveContextMessage` closure passed into `createChatStore`.
- `chat-store.ts` — `createChatStore()` gained one **optional**, trailing parameter
  (`resolveContextMessage?: ResolveContextMessage`). `consume()` calls it immediately before
  `client.run()` and, if it returns non-empty content, prepends a `system` message. The
  parameter type allows a synchronous `undefined` return specifically so a provider with
  nothing registered dispatches on the same tick Phase 3 always did (see Architecture doc
  and [Decisions](Phase_4_Decisions.md) for why this mattered enough to design around).
- `index.ts` — exports the two new hooks and their option/result types, and re-exports the
  `@gixcopilot/context` types a consumer needs to type a call
  (`ContextScope`/`ContextPriority`/`ContextSensitivity`/`ResolvedContext`/`ContextInspection`
  /`StateScope`/`StateValidator`/`StateValidationResult`/`ContextExclusionReason`) so most
  consumers never need a direct `@gixcopilot/context` dependency.

## `examples/react-context` (new example)

A self-contained demo app (own dev server on `:4319`, own Vite dev server on `:5175`,
mirroring `examples/react-basic`'s structure): an "Applications" page registering page/user/
selected-entity context and exposing a status filter as state-derived context, backed by a
deterministic, non-network `context-aware` `ModelProvider` (`src/backend.ts`) whose answer is
templated entirely from the fields it parses out of the request's leading `system` message —
proving context reaches the real model request, not a hardcoded UI response. See
`examples/react-context/README.md`.

## Dependencies added

None beyond workspace-internal references (`@gixcopilot/context` as a new dependency of
`@gixcopilot/react` and the new example). No new third-party npm package was added anywhere
in the workspace for Phase 4 — the default token estimator, serializer, and compressor are
all hand-written with zero dependencies (see [Decisions](Phase_4_Decisions.md)).

## Notable implementation tradeoffs

- **Deduplication compares serialized *values*, not raw object references or names.** Two
  context items registered under different names/scopes but holding the same underlying
  entity (e.g. the same application surfaced by both `page` and `component` scope)
  collapse to one, keeping the higher-priority registration.
- **Compression only kicks in above a minimum viable remaining budget** (16 tokens) — below
  that, an item is excluded outright rather than "included" as a barely-legible fragment.
- **State registration happens during render, not an effect**, because
  `useSyncExternalStore`'s first snapshot read (also during render) needs the slot to
  already exist. It is idempotent (a second `register()` call for an existing id never
  resets its value), so this is safe under React's Strict Mode double-render.
