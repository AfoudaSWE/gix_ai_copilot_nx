# Phase 4 Architecture

## Dependency direction

```text
                 Protocol
                /        \
            Client       Core  <-  Model Runtime  <-  Provider adapters
              ^          ^  ^
              |          |  Server
     @gixcopilot/react ->|
              ^
              |
    @gixcopilot/context (protocol only - no React)
              ^
              |
     @gixcopilot/react (adapter over context)
```

`@gixcopilot/context` depends only on `@gixcopilot/protocol` (reused solely for
`CopilotError`, so context/state errors share the SDK's one error taxonomy). It has **no**
React, Angular, or provider-SDK dependency — enforced by `@nx/enforce-module-boundaries`
(`scope:context` may only depend on `scope:protocol`/`scope:context`; see `eslint.config.js`).
`@gixcopilot/react` gained one new workspace dependency on `@gixcopilot/context`; nothing
else in the Phase 1–3 graph changed direction. Server/core packages were **not** touched —
context injection happens entirely inside the React adapter (see "Model integration" below).

## Context pipeline

```text
Context Registry (createContextRegistry)
        |  register / update / patch / remove / list / subscribe
        v
Context Engine (createContextEngine)
  collect -> validate(*) -> serialize -> filter(enabled, sensitivity)
  -> deduplicate -> prioritize -> budget/truncate/compress -> ResolvedContext
        v
ResolvedContext { items, content, estimatedTokens, excluded, diagnostics }
```

`(*)` "validate" has no runtime branch today: `ContextRegistry` already rejects a blank name
at admission time, so every item the engine sees is structurally valid. The `'invalid'`
exclusion reason stays part of the type for a future validated-input path (e.g. a
schema-checked registration) — see [Decisions](Phase_4_Decisions.md).

Each stage is an independently testable pure function/module
(`context-registry.ts`, `context-serializer.ts`, `context-engine.ts`, `context-compressor.ts`,
`token-estimator.ts`, `context-format.ts`) — see `packages/context/src/*.spec.ts` (50 tests).

### Serialization boundary

`createDefaultContextSerializer()` never runs `JSON.stringify` on an arbitrary application
value directly. It walks the value once, converting it into a JSON-safe shape while
recording what it had to normalize or omit (`warnings`): `undefined` omitted, `Date` → ISO
string, `bigint` → suffixed string, functions/symbols/DOM-like nodes omitted, circular
references replaced with `'[Circular]'`, class instances normalized to their own enumerable
properties (or `toJSON()` when present), oversized strings/arrays truncated, recursion
capped at a max depth. It never throws on adversarial input (see
`context-serializer.spec.ts`).

### Budgeting and truncation

`ContextEngine` sorts included candidates by priority tier (`critical` → `high` → `normal`
→ `low`, ties broken by registration order), then walks them once, subtracting each item's
estimated tokens from the remaining budget:

- Fits within the remaining budget → included as-is.
- Doesn't fit, and the remaining budget is below `MIN_COMPRESSIBLE_BUDGET_TOKENS` (16) → the
  compressor would only produce a near-useless fragment, so the item is excluded outright
  (`reason: 'budget'`).
- Doesn't fit, but the remaining budget is worth compressing into → `ContextCompressor`
  shrinks the item's formatted block toward the remaining budget; if it still doesn't fit,
  it's excluded (`reason: 'budget'`).

`createTruncatingCompressor()` is the Phase 4 default: it iteratively resizes text toward a
target token count using whatever `TokenEstimator` was configured (not a hardcoded
chars-per-token constant), so it stays correct for a future, more accurate estimator. The
`ContextCompressor` interface is async-capable specifically so a later phase can plug in an
LLM-based summarizer without touching `ContextEngine`'s pipeline — see
[Decisions](Phase_4_Decisions.md) for why it operates on one item's text, not the whole
`ResolvedContext`, unlike the brief's literal code sample.

### Deduplication

Identical *serialized values* (not just similar-looking ones) collapse to the
highest-priority (then earliest-registered) candidate; the rest are excluded
(`reason: 'duplicate'`). This is an identity/hash comparison on the serializer's output text,
never a fuzzy similarity guess (context-engine skill's explicit requirement).

### Sensitivity

`ContextSensitivity` (`public`/`internal`/`sensitive`/`restricted`) is metadata only. The
engine's default policy excludes `restricted` items (`reason: 'sensitivity-policy'`) — a
conservative default, not a security boundary. It is overridable via
`ContextEngineOptions.sensitivityPolicy`. Phase 7 owns real enforcement.

### Error isolation

One item's serialization throwing does not abort the whole resolution: the engine wraps
each item's `serializer.serialize()` call individually and excludes only that item
(`reason: 'serialization-failure'`, `detail` carries the error message) — see
`context-engine.spec.ts`'s "isolates a broken item" test.

## State pipeline

```text
Application / React component
        |  useCopilotState(...)
        v
CopilotStateStore (createCopilotStateStore)
  register(idempotent seed) -> get/set/update -> subscribe(id, listener)
        v
                     explicit opt-in only
                            v
        useCopilotContext(...)  ->  Context Registry  ->  (same pipeline as above)
```

State and context are deliberately separate stores with separate identities. A
`useCopilotState` value is never sent to a model unless `exposeToModel` is set — when it is,
the React hook composes `useCopilotContext` internally (scope `'session'`), so the exposure
path reuses the exact same registry/engine/budget/serialization pipeline as any other
context item, rather than a parallel "state-to-prompt" code path.

## React integration

```text
CopilotProvider
  |
  +-- creates, once per provider instance (Section 65 isolation):
  |     registry = createContextRegistry()
  |     engine   = createContextEngine({ maxContextTokens })
  |     stateStore = createCopilotStateStore()
  |
  +-- provides them via CopilotInternalsContext (packages/react/src/internals.ts)
  |
  +-- builds `resolveContextMessage` (a plain closure, no @gixcopilot/context types
  |   leaking into chat-store.ts) and passes it into createChatStore(...)
  |
  useCopilotContext(options)          useCopilotState(options)
    registers in an effect              register()s a slot during render (idempotent)
    (mount -> register, unmount ->      useSyncExternalStore subscribes to it
     dispose); later renders patch()    controlled mode bridges an external value in
    the SAME registration, never        exposeToModel composes useCopilotContext
    re-registering
```

`useCopilotContext`'s stable identity defaults to React's own `useId()` when no explicit `id`
is given — StrictMode-safe (its mount→cleanup→mount double-invoke still nets exactly one live
registration) and stable across ordinary re-renders (Section 36–37).

### Model integration (the mandatory Phase 4 outcome)

Resolved context reaches the model as a **leading `system` message** prepended to the
existing `messages` array `chat-store.ts` already builds — chosen over a new protocol field
because it requires zero changes to `@gixcopilot/protocol`, `@gixcopilot/core`, or
`@gixcopilot/server` (see ADR 0009 for the full placement decision and the alternatives
considered):

```text
Resolved application context (ResolvedContext.content)
        |
        v
{ role: 'system', content: [{ type: 'text', text: content }] }  <- prepended, only if non-empty
        |
        v
[...that system message, ...existing conversation history]
        v
client.run({ messages })  ->  POST /runs  ->  core Runtime  ->  Executor  ->  ModelRuntime
```

`resolveContextMessage` (`packages/react/src/chat-store.ts`'s `ResolveContextMessage` type)
can return synchronously (`undefined`) when nothing is registered, so a provider with zero
context items dispatches `client.run()` on the exact same tick Phase 3 always did — no
observable timing regression for existing consumers (Section 64, verified by
`provider.spec.tsx`'s unmodified Phase 3 suite still passing unchanged).

## Diagnostics / inspection foundation

`ContextEngine.inspect(registry)` (exposed to React via `useCopilotContextDebug()`) reruns
`resolve()` and projects it into `{ estimatedTokens, included: [...], excluded: [...],
diagnostics }` — the data shape Phase 11's DevTools context inspector will consume. No UI is
built in Phase 4.
