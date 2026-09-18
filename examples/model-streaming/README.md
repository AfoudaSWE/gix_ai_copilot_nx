# model-streaming-demo

The Phase 2 end-to-end demonstration of the AI Copilot SDK's LLM runtime:

```text
Client -> HTTP -> Server -> Core -> Model Runtime -> Provider -> Streaming tokens -> SSE -> Client
```

By default this uses `@gixcopilot/provider-mock`'s deterministic provider — **no API key or
network access required.** Set `OPENAI_API_KEY` (and optionally `MODEL_PROVIDER=openai`) to
stream from a real OpenAI model instead.

## Run it

```sh
# mock provider (default, no credentials needed)
pnpm --filter @gixcopilot/model-streaming-demo run demo

# with a custom prompt
pnpm --filter @gixcopilot/model-streaming-demo run demo -- "Explain event-driven architecture"

# real OpenAI streaming
OPENAI_API_KEY=sk-... MODEL_PROVIDER=openai pnpm --filter @gixcopilot/model-streaming-demo run demo
```

Expected output (mock provider):

```text
Provider: mock
Model: mock-model

> Explain event-driven architecture in two sentences.

Explain
 event-driven
 architecture
 in
 two
 sentences.

Finish reason: stop
Input tokens: 0 | Output tokens: 0 | Total tokens: 0
```

(The mock provider in this demo echoes the prompt back rather than answering it — see
`@gixcopilot/provider-mock`'s README for why: it exists to prove the architecture
deterministically, not to simulate intelligence. Point it at a real provider to see an
actual answer.)

## Tests

- `src/integration.spec.ts` — **mandatory**, always runs in CI: the full mock round trip
  (client → server → core → model runtime → mock provider → SSE → client), including
  cancellation and a provider-failure path. No credentials, no network access.
- `src/openai-smoke.spec.ts` — **optional**, real-network smoke test against the actual
  OpenAI API. Skipped (not failed) unless `OPENAI_API_KEY` is set:

  ```sh
  OPENAI_API_KEY=sk-... pnpm --filter @gixcopilot/model-streaming-demo test
  ```

  This costs a small amount of real money when it runs and is never required for CI.

## What this proves

- `@gixcopilot/provider`'s `ModelRuntime` correctly streams, retries, times out, cancels,
  and normalizes errors/usage/finish-reason independent of which provider is behind it.
- `@gixcopilot/server` routes a request naming a `model` through the injected
  `ModelRuntime`, while a request without one still runs against the Phase 1 default
  executor unchanged.
- `@gixcopilot/client` needed zero changes to support model-backed runs beyond the
  additive `model` field - the same `run()`/`events`/`cancel()` API from Phase 1.
- Swapping providers (mock ↔ OpenAI) requires no code change anywhere except which
  provider is registered and named in the request - see `docs/adr/0006-model-provider-abstraction.md`.

## Non-responsibilities

No tool calling, no agents, no RAG, no UI - this example is a proof of the Phase 2 model
runtime only.
