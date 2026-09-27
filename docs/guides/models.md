# Models, providers and routing

No provider is mandatory. The runtime talks to a `ModelProvider` interface; adapters shipped:

| Adapter | Package | Status |
| --- | --- | --- |
| OpenAI (chat completions, streaming, tools; embeddings in `@gixcopilot/rag`) | `@gixcopilot/provider-openai` | Stable |
| Deterministic mock (tests, development, demos; labelled wherever used) | `@gixcopilot/provider-mock` | Stable |
| Anthropic, Gemini, Ollama/local | not shipped; implement `ModelProvider` (one `stream()` method) | — |

Keys stay on the server: `Application → server → ModelProvider → OpenAI adapter → OpenAI`,
never browser → OpenAI.

## Runtime

`createModelRuntime({ providers, defaults: { retry, timeoutMs } })` streams normalized events,
retries transient failures before the first token, supports cancellation and reports usage.
`createServer({ defaultModel })` / `createCopilot({ model })` let the **server** pick the model.

## Production routing (`@gixcopilot/model-router`, Beta)

```ts
const health = createProviderHealth();
const router = createModelRouter({ catalog, strategy: { type: 'fallback', chain: [primary, backup] }, health });
const modelRuntime = createRoutedModelRuntime({ runtime: createModelRuntime({ providers }), router, health });
```

- Strategies: `fixed`, `fallback`, `capability` (tools, vision, structured output, context
  window), `policy` (tenant, project, environment, task). All deterministic, and every route
  carries a reason.
- Health is tracked per model, over a window, needs a minimum sample and cools down.
- Fallback is per model call and only before any output. Invalid requests, authentication or
  configuration errors, schema errors, cancellation and security denials never fall back.
  Tool calls already executed are in the history, so a fallback model never repeats a side
  effect.
- "Route cheaper" happens only through an explicit budget policy ([Usage and cost](../production/USAGE_AND_COST.md)).

## Local models

There is no Ollama adapter. A local model server with an OpenAI-compatible API can be reached
with `createOpenAIProvider({ baseURL, apiKey })`. Capabilities (tools, context window) differ
from cloud models, so declare them honestly in the router catalog.
