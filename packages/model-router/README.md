# @gixcopilot/model-router

Production model routing for the AI Copilot SDK (**Beta**). Provider-neutral: it routes
between whatever provider adapters you register (OpenAI, the mock provider, or your own
`ModelProvider`).

## Install

```bash
npm install @gixcopilot/model-router
```

Requires Node.js >=22.12.0. ESM only.

```ts
const health = createProviderHealth();
const router = createModelRouter({
  catalog: [
    { provider: 'openai', model: 'gpt-4o', capabilities: { streaming: true, tools: true, structuredOutput: true, vision: true, contextWindow: 128_000 }, tier: 'premium' },
    { provider: 'openai', model: 'gpt-4o-mini', capabilities: { ... }, tier: 'economy' },
  ],
  strategy: { type: 'fallback', chain: [...] },   // or fixed | capability | policy
  health,
});
const modelRuntime = createRoutedModelRuntime({ runtime: createModelRuntime({ providers }), router, health });
createCopilot({ model, modelRuntime, ... });      // or createServer({ modelRuntime, ... })
```

**Strategies** (deterministic, each route carries a `reason`): `fixed`, `fallback` (a chain),
`capability` (catalog order filtered by required capabilities such as tools, vision,
structured output and context window), `policy` (first matching rule on tenant, project,
environment or task type). A requested model is honored only if it is in the catalog.
Cheaper-tier routing happens only when a request carries `preferTier`, set by an explicit
budget policy. Models are never silently downgraded.

**Health** is tracked per model over a window. A model is taken out of first position only
after `minSamples` calls with a failure ratio of at least `failureRatio`, then retried after a
cooldown. One failure never marks a provider down.

**Fallback safety**:
- Fallback applies to one model call, not a whole run. In the server's tool loop, tool results
  that already executed are in the next call's history, so a fallback model continues the
  conversation and never repeats a side effect (tested: a refund executes exactly once when
  the model fails after it).
- No fallback once the failing call has emitted text or a tool call.
- Eligible errors: rate limit, timeout, network, retryable provider/model errors.
- Never: invalid request, authentication/configuration errors, schema/structured-output
  errors, context overflow, unknown model, cancellation, and security or approval denials.

## Documentation

- [models guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/models.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/model-router)

## License

MIT
