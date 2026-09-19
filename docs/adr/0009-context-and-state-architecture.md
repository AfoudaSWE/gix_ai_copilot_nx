# 0009 — Context and State Architecture

## Status

Accepted (Phase 4).

## Context

Phase 4's stated mission is to make the Copilot understand the application around the
conversation: registered context (application/user/page/component/session/temporary) must
reach a real model request, deterministically, within a token budget, without becoming a
security boundary or leaking React into the framework-independent layers. Several
architectural questions had to be settled before writing code: where does the context
package sit relative to `protocol`/`core`/`react`; how does resolved context actually reach
`client.run()` without a protocol/server change; how is "state" different from "context";
and how much of the budgeting/compression system is worth building now versus deferring.

## Decision

- **New package `@gixcopilot/context`, depending only on `@gixcopilot/protocol`.** Not on
  React, not on any provider SDK, not on `@gixcopilot/core`/`@gixcopilot/client`/
  `@gixcopilot/server`. The only thing it borrows from `protocol` is `CopilotError`, so
  context/state errors use the SDK's one error taxonomy instead of a parallel one.
  `@gixcopilot/react` depends on it (new edge); nothing else does. Enforced by
  `@nx/enforce-module-boundaries` (`scope:context` → `protocol, context` only).
- **Context reaches the model as a leading `system` message, built entirely inside
  `@gixcopilot/react`.** `chat-store.ts` gained one optional, trailing constructor
  parameter — a plain `() => Promise<string | undefined> | string | undefined` closure — and
  prepends `{ role: 'system', content: [{ type: 'text', text }] }` when it returns non-empty
  content. `@gixcopilot/protocol`, `@gixcopilot/core`, and `@gixcopilot/server` are
  **untouched**. `chat-store.ts` itself imports no `@gixcopilot/context` type — only
  `provider.tsx` bridges `ContextEngine.resolve(registry)` into that closure.
- **The resolver can return synchronously.** Real context resolution is always `async`
  (`ContextEngine.resolve()` returns a `Promise`, since a future compressor may itself be
  async), but a provider with nothing registered would otherwise pay a one-microtask delay
  on every single send, and — more concretely — broke Phase 3's `provider.spec.tsx` fixture,
  which asserts `client.run()` is called synchronously within the same `act()` as
  `sendMessage()`. `provider.tsx`'s `resolveContextMessage` checks
  `registry.list({ enabledOnly: true }).length === 0` first and returns `undefined`
  synchronously in that (common, Phase-3-equivalent) case; `chat-store.ts`'s `consume()`
  only `await`s when it actually receives a `Promise`.
- **State and context are two separate stores with separate identities**
  (`CopilotStateStore` vs. `ContextRegistry`), and a state value is **never** automatically
  exposed to a model. `useCopilotState`'s optional `exposeToModel` composes
  `useCopilotContext` internally (scope `'session'`) rather than writing a second,
  parallel "state-to-prompt" code path — exposed state goes through the exact same
  serialization/budget/dedup pipeline as any other context item.
- **Deduplication and priority use identity/hash comparisons, never fuzzy similarity.**
  Two items are "the same" only if their *serializer output text* is byte-identical; ties
  are broken by priority tier, then registration order. An explicit `id` is the only
  update-in-place identity; an omitted `id` always creates a new item.
- **`ContextCompressor` operates on one item's already-formatted text, not the whole
  `ResolvedContext`** — narrower than the brief's own code sample
  (`compress(context: SerializedContext, budget: number)`). `ContextEngine` already performs
  whole-context priority/budget selection itself; it only reaches for a compressor when one
  individual item doesn't fit in whatever budget remains for it. A whole-context compression
  stage (e.g. summarizing older conversation turns) is a plausible future addition but is not
  what Phase 4's brief actually requires, and building it now would be scope creep against
  the "start deterministic, no LLM-based selection" instruction (Section 19, 29).
- **Sensitivity is metadata with one conservative default behavior (exclude `restricted`),
  not enforcement.** Overridable via `ContextEngineOptions.sensitivityPolicy`. Phase 7 owns
  real authorization/PII policy.
- **`useCopilotContext`'s default stable identity is React's own `useId()`.** Registration
  happens in an effect (mount → register, unmount → dispose, mirroring `CopilotProvider`'s
  own `store.mount()/dispose()` pattern); later option/value changes go through the *same*
  registration's `patch()` in a second effect, never a dispose+re-register cycle.

## Consequences

- No protocol version bump, no server schema change, no core `Executor` change — Phase 4 is
  purely additive at every layer below `@gixcopilot/react`. Every Phase 3
  `CopilotProviderProps` value and every existing `provider.spec.tsx` assertion (including
  the ones asserting synchronous `client.run()` dispatch) needed zero changes.
- A host application that wants context/state without React can use
  `@gixcopilot/context` directly (`createContextRegistry`/`createContextEngine`/
  `createCopilotStateStore`) and build its own bridge into a request — the same shape
  `@gixcopilot/react`'s adapter uses internally.
- Because state exposure is opt-in and explicit, an application cannot accidentally leak an
  internal state slot to the model just by calling `useCopilotState` — a real, if narrow,
  security-adjacent default (see the security skill's "zero trust"/least-privilege framing).
- The synchronous-fast-path decision means `resolveContextMessage`'s type
  (`Promise<string | undefined> | string | undefined`) is slightly unusual for a "resolver"
  API; this is documented inline in `chat-store.ts` and in the Architecture doc rather than
  left as an unexplained special case.

## Alternatives Considered

- **A dedicated `Context`/`context` field on the protocol's run-request shape**, carried all
  the way through `client` → `server` → `core` → `Executor` → `ModelRuntime`. Rejected for
  Phase 4: it would require a protocol version bump, a server schema change, and teaching
  `@gixcopilot/core`'s `Executor` interface and every `ModelProvider` adapter about a new
  concept, none of which the phase's brief requires ("do not add OpenAI-specific behavior to
  the context engine," Section 33). A `system` message is already a first-class,
  provider-neutral `MessageRole` every layer already understands. Revisit only if a future
  phase needs the model runtime itself to reason about context distinctly from conversation
  (e.g. per-provider context-window-aware placement).
- **Always resolving context asynchronously**, updating the existing `provider.spec.tsx`
  fixture instead of adding a synchronous fast path. Rejected: it would change observable
  dispatch timing for every Phase-3-era consumer with zero registered context (the common
  case for any app that hasn't adopted Phase 4 yet), which is a real, if subtle, regression
  risk for no benefit — see Section 64's explicit backward-compatibility requirement.
- **A single `useCopilotState({ exposeToModel: true })` that always exposes with a fixed
  scope/priority**, instead of composing `useCopilotContext` with configurable overrides.
  Rejected: it would make the state→context bridge a special, less capable path than
  registering context directly, undermining "prefer explicitness" (Section 51) by hiding a
  second, lesser context API behind the state hook.
- **A `ContextCompressor` that operates on the whole assembled `SerializedContext`**, exactly
  matching the brief's illustrative code sample. Rejected in favor of a narrower,
  per-item interface — see "Decision" above; the whole-context shape can be added as an
  additional pipeline stage later without breaking this interface.
