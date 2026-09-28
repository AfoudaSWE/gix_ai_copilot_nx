# @gixcopilot/core

> **Status:** Stable. See [stability levels](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/VERSIONING.md#stability-levels).

## Purpose

## Install

```bash
npm install @gixcopilot/core
```

Requires Node.js >=22.12.0. ESM only.

Framework-independent runtime foundation for the AI Copilot SDK. Owns run lifecycle, event
sequencing, and cancellation over a generic "executor" boundary — with no dependency on any
LLM provider, HTTP framework, or UI framework.

## Responsibilities

- `RunLifecycle` — a strict state machine enforcing valid `RunStatus` transitions
  (`created → running → {completed | failed | cancelled}`, plus `created → cancelled`).
- `EventSequencer` — owns per-run, 1-based, strictly increasing event sequence numbers.
- `cancellable()` — races a source `AsyncIterable`/`AsyncGenerator` against an
  `AbortSignal`, always releasing the source iterator via `.return()` (including against a
  hung source), and propagating the source generator's own return value through when it
  finishes naturally.
- `Executor` — the generic run/execution boundary: given the conversation so far, stream
  the assistant's reply as text deltas, honoring cancellation, and optionally reporting
  `ExecutorCompletion` (`usage`/`finishReason`) once done. No model, prompt, or provider
  concept lives here — see `@gixcopilot/provider`'s `createModelExecutor` for the Phase 2
  implementation of this interface backed by a real (or mock) model.
- `createEchoExecutor()` — a deterministic, non-AI reference `Executor` used by this
  package's own tests and by `examples/protocol-demo` to prove the architecture end to end.
- `createRuntime({ executor })` — orchestrates one `Run`: emits `run.started`, drives the
  executor, translates its output into `message.started` / `message.delta` / `message.end`
  events, and emits `run.completed` (carrying the executor's reported usage/finishReason,
  when it provided any) / `run.failed` / `run.cancelled`.

## Public API

See `src/index.ts`. No deep imports into `src/` are supported (the package's `exports`
field only exposes `.`).

## Dependencies

- `@gixcopilot/protocol` — the only workspace dependency, per the dependency-direction rule
  in `docs/architecture/overview.md` (`core → protocol`, never the reverse). Notably, core
  still does **not** depend on `@gixcopilot/provider` — it's the other way around; see
  `docs/adr/0006-model-provider-abstraction.md`.

## Non-responsibilities

- **No LLM runtime.** `Executor` is intentionally generic; `@gixcopilot/provider` owns the
  actual model/provider abstraction, retries, timeouts, and provider-specific token
  accounting — core only knows how to carry whatever `usage`/`finishReason` an executor
  hands it.
- **No transport.** HTTP/SSE/WebSocket belong to `@gixcopilot/server` / `@gixcopilot/client`.
- **No multi-subscriber event fan-out.** A `RuntimeRun.events` iterable is single-use and
  single-consumer; iterating it a second time throws. Broadcasting one run's events to
  multiple independent subscribers is out of scope.
- **No persistence.** Run/event state exists only for the lifetime of the async generator
  driving it; nothing is written to a database (`@gixcopilot/server` will decide whether/how
  to persist runs when it needs to, e.g. for the cancel-by-id endpoint's run registry).
- **`createEchoExecutor` is a test/demo fixture, not a production component** — it must
  never be used as a template for a real model integration.

## Basic Usage

```ts
import { createRuntime, createEchoExecutor } from '@gixcopilot/core';

const runtime = createRuntime({ executor: createEchoExecutor() });
const run = runtime.run({
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello protocol' }] }],
});

for await (const event of run.events) {
  console.log(event.type);
}
```

## Documentation

- [concepts guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/concepts.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/core)

## License

MIT
