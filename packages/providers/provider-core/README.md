# @aicopilot/provider

## Purpose

Provider-independent model contracts, a provider registry, and a model execution runtime.
This is the layer the rest of the SDK talks to for "run a model" — it has no idea whether
that means OpenAI, Anthropic, or a deterministic mock.

## Responsibilities

- `ModelMessage`, `ModelRequest`, `ModelReference`, `ModelStreamEvent` — the provider-neutral
  contract every adapter implements against.
- `ModelProvider` — the interface a concrete provider (OpenAI, mock, ...) implements:
  `{ id, stream(request, options) }`.
- `createModelProviderRegistry()` — a plain, dependency-injectable registry (no global
  singleton); `register`/`get`/`require`/`list`.
- `createModelRuntime({ providers, defaults, defaultProvider, defaultModel, onTelemetry })`
  — provider lookup, request normalization, streaming, cancellation, timeout, retry
  (bounded exponential backoff with jitter, never retrying once content has streamed or
  after user cancellation), and usage/latency capture.
- `createModelExecutor({ runtime, model, ... })` — the bridge into `@aicopilot/core`'s
  `Executor` boundary, so `createRuntime({ executor: createModelExecutor({...}) })` drives
  a real model exactly the way Phase 1 drove `createEchoExecutor()`.

## Public API

See `src/index.ts`. No deep imports into `src/` are supported.

## Dependencies

- `@aicopilot/protocol` and `@aicopilot/core` — see
  `docs/adr/0006-model-provider-abstraction.md` for why this package depends on core
  (to implement its `Executor` interface) rather than the other way around.
- No provider SDK is a dependency of this package — see `@aicopilot/provider-openai`.

## Non-responsibilities

- **No concrete provider.** This package defines the contract; `@aicopilot/provider-mock`
  and `@aicopilot/provider-openai` implement it.
- **No agent logic.** This is a _model execution_ runtime, not an agent runtime — no
  planning, no tool calling, no multi-step orchestration (Phase 5/10).
- **No intelligent model routing or automatic multi-model fallback.** `defaultProvider`/
  `defaultModel` are static configuration, not a routing engine (Section 35/36).
- **No full observability platform.** `onTelemetry` is a lightweight, injectable callback;
  Phase 11 owns the DevTools/observability platform this could feed into.

## Basic Usage

```ts
import { createModelRuntime, createModelExecutor } from '@aicopilot/provider';
import { createMockProvider } from '@aicopilot/provider-mock';
import { createRuntime } from '@aicopilot/core';

const modelRuntime = createModelRuntime({
  providers: [
    createMockProvider({ scenario: { chunks: ['Hello', ' world'], finishReason: 'stop' } }),
  ],
});

const runtime = createRuntime({
  executor: createModelExecutor({
    runtime: modelRuntime,
    model: { provider: 'mock', model: 'mock-model' },
  }),
});

const run = runtime.run({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] });
for await (const event of run.events) {
  console.log(event.type);
}
```
