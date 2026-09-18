# 0006 — Model Provider Abstraction

## Status

Accepted (Phase 2).

## Context

Phase 2's stated goal is that "the rest of the SDK must not care whether the underlying
model is OpenAI, Anthropic, Gemini, Ollama, or another provider." Phase 1 already
established `@aicopilot/core`'s generic `Executor` boundary specifically so a real model
integration could attach to it later (see `docs/adr/0002-framework-independent-core.md`).
Phase 2 has to decide: where does the new provider/model-runtime code actually live
relative to `core`, and how does a real model's output (usage, finish reason, retries,
timeouts) reach the existing protocol without turning `core` into something model-aware?

## Decision

- **New packages, layered _above_ `@aicopilot/core`, not pulled into it:**
  - `@aicopilot/provider` (`packages/providers/provider-core`) — the provider-neutral
    contract (`ModelMessage`, `ModelRequest`, `ModelReference`, `ModelStreamEvent`,
    `ModelProvider`), the registry, the `ModelRuntime` (retry/timeout/cancellation/
    latency/usage orchestration), and `createModelExecutor` — the bridge that makes a
    `ModelRuntime` usable as a `@aicopilot/core` `Executor`.
  - `@aicopilot/provider-mock` and `@aicopilot/provider-openai` — concrete adapters,
    depending on `@aicopilot/provider` (+ `protocol`), never on each other.
  - **`@aicopilot/core` gains no new workspace dependency.** It is `@aicopilot/provider`
    that depends on `core` (to implement its `Executor` interface), the same direction
    `@aicopilot/server` already depends on `core` — not the reverse. Enforced by
    `@nx/enforce-module-boundaries` (`scope:provider` → `protocol, core, provider` only;
    `scope:provider-adapter` → `protocol, core, provider` only, explicitly excluding each
    other).
- **`@aicopilot/core`'s `Executor` interface is extended, additively, to carry completion
  metadata.** `execute()` now returns `AsyncGenerator<string, ExecutorCompletion | void,
undefined>` instead of a plain `AsyncIterable<string>` — a generator's own return value
  (`usage`/`finishReason`) is threaded through `cancellable()` (now generic over `TReturn`)
  and used to populate `run.completed`, instead of the executor's output being pure text.
  `createEchoExecutor` still works unmodified (it simply returns nothing, defaulting to
  empty usage / no finish reason) — this is additive at the source level, not a rewrite.
- **The protocol gains two additive changes**, both optional:
  - `RunCompletedEvent.finishReason?: FinishReason` (`'stop' | 'length' | 'content_filter' |
'cancelled' | 'error' | 'unknown'`) — absent for a non-model run, present for a
    model-backed one.
  - `CopilotErrorCode` gains `MODEL_ERROR`, `PROVIDER_ERROR`, `AUTHENTICATION_ERROR`,
    `RATE_LIMITED`, `MODEL_NOT_FOUND`, `CONTEXT_LIMIT_EXCEEDED`, `TIMEOUT`,
    `NETWORK_ERROR` (Section 26), with matching `CopilotError` static factories.
- **The Phase 1 request shape changes**: `message` (singular) becomes `messages` (an
  array, oldest first) on `RunOptions`/the server's request schema/the client's
  `RunOptions`, so a model executor can see conversation history, not just the latest
  turn. A new optional `model: { provider, model }` field selects a model-backed run; its
  absence preserves exact Phase 1 behavior (the server's default injected `Runtime`).
- **A `ModelProvider` never retries internally** (`@aicopilot/provider-openai` explicitly
  sets `maxRetries: 0` on the OpenAI SDK client) — retry is `ModelRuntime`'s job alone, so
  there is exactly one place retry policy and telemetry exist, not two uncoordinated ones.
- **The model runtime never retries once any content has streamed**, regardless of whether
  the failure is classified retryable — a partially-streamed response cannot be safely
  replayed without producing a garbled or duplicated result for the consumer.

## Consequences

- Phase 3's React SDK and any future Angular SDK need no awareness that a model exists
  behind a run — they consume the same `CopilotEvent` stream either way, with
  `finishReason` simply present or absent.
- Adding a second real provider (Anthropic, Gemini, Ollama) is: one new package depending
  on `@aicopilot/provider` + that provider's own SDK, registered alongside existing
  providers in whatever `createModelRuntime({ providers: [...] })` call constructs the
  runtime. No other package changes.
- Because `messages` replaced `message`, this is a breaking change to the Phase 1 request
  shape. Acceptable here because nothing is published/versioned yet (all packages remain
  `"private": true`, pre-1.0) — see `docs/adr/0005-module-resolution-and-build-strategy.md`
  and the backward-compatibility skill's guidance that pre-1.0, unpublished churn is
  distinct from a real SemVer break. This would not be acceptable once a package is
  actually published.
- `run.completed.finishReason` being optional (rather than required) means a consumer must
  not assume it is always present — it is a model-specific enrichment of an already
  general-purpose event, not a redefinition of it.

## Alternatives Considered

- **Make `@aicopilot/core` depend on `@aicopilot/provider`** (core "knows about" models
  directly). Rejected: this is exactly the coupling Phase 1's `Executor` boundary exists to
  prevent, and would make it impossible to use `@aicopilot/core` in a context with no model
  concept at all (e.g., a hypothetical non-AI use of the same runtime primitives).
- **Model reference as a colon-delimited string** (`"openai:gpt-4o-mini"`). Rejected in
  favor of an explicit `{ provider, model }` object — the registry already keys providers
  by a plain string id, so a combined string would just need to be parsed back apart with
  no benefit, and an object is safer against providers or models containing `:` themselves.
- **Keep `message` singular and bolt history on separately** (e.g. a `history` field).
  Rejected: an array is the standard, simplest representation of a conversation, and every
  provider's own API already expects an ordered message array — anything else would need
  translating in two places instead of one.
- **Let each `ModelProvider` implement its own retry loop.** Rejected: retry policy
  (Section 24) must be uniform, testable via the deterministic mock provider, and visible
  through one telemetry stream — duplicating it per-adapter would fragment all three.
