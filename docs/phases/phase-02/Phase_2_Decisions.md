# Phase 2 Decisions

The full reasoning for each of these lives in
[ADR 0006](../../adr/0006-model-provider-abstraction.md); this file is a short index of
what was decided and why, for anyone who wants the summary without the full ADR.

1. **Provider packages depend on `@aicopilot/core`, not the other way around.**
   `@aicopilot/core` gained zero new workspace dependencies this phase. The model
   abstraction is a new layer built _on top of_ core's existing `Executor` boundary.

2. **`Executor.execute()`'s return type was extended additively**: from
   `AsyncIterable<string>` to `AsyncGenerator<string, ExecutorCompletion | void,
undefined>`. `createEchoExecutor` needed no behavior change — it simply never returns a
   completion value, which is a valid `void`.

3. **`RunOptions.message` (singular) became `RunOptions.messages` (an array)** across core,
   server, and client, so a model executor receives conversation history, not just the
   latest turn. This is a real, intentional break from Phase 1's request shape — acceptable
   because nothing is published/versioned yet (see the ADR's "Consequences" section).

4. **A model reference is `{ provider, model }`, not a colon-delimited string.** The
   registry already keys providers by a plain string id; an object avoids parsing a string
   back apart for no benefit.

5. **Retry lives only in `ModelRuntime`, never in a provider adapter.** The OpenAI adapter
   explicitly disables the SDK's own built-in retry (`maxRetries: 0`) so there is exactly
   one place retry policy and telemetry exist.

6. **The model runtime never retries once any content has streamed**, even for an error
   classified retryable — a partial response cannot be safely replayed without corrupting
   or duplicating what the consumer already received.

7. **`finishReason` is optional on `RunCompletedEvent`**, present only for a model-backed
   run — an additive protocol change, not a redefinition of what `run.completed` means.

8. **Provider adapters never fabricate usage.** If a provider doesn't report token counts
   (or a scenario in the mock provider doesn't set them), `usage` stays `undefined` all the
   way through to `run.completed` — never defaulted to zero or guessed.

9. **`@aicopilot/client` does not depend on `@aicopilot/provider`.** `ClientModelReference`
   is a small, locally-duplicated `{ provider, model }` type, so the client works identically
   whether or not the server it's talking to has any model support configured.

10. **Two example apps, not one extended.** `examples/protocol-demo` (Phase 1, deterministic
    echo executor) was left alone rather than retrofitted with model support;
    `examples/model-streaming` is new, dedicated to proving Phase 2's architecture. This
    keeps each example's purpose singular and its required "no LLM"/"has LLM" claims true.
