# @aicopilot/core

## Purpose

Framework-independent runtime foundation for the AI Copilot SDK. Owns run lifecycle, event
sequencing, and cancellation over a generic "executor" boundary — with no dependency on any
LLM provider, HTTP framework, or UI framework.

## Responsibilities

- `RunLifecycle` — a strict state machine enforcing valid `RunStatus` transitions
  (`created → running → {completed | failed | cancelled}`, plus `created → cancelled`).
- `EventSequencer` — owns per-run, 1-based, strictly increasing event sequence numbers.
- `cancellable()` — races a source `AsyncIterable` against an `AbortSignal`, always
  releasing the source iterator via `.return()`, including against a hung source.
- `Executor` — the generic run/execution boundary: given one input message, stream the
  reply as text deltas, honoring cancellation. No model, prompt, or provider concept lives
  here.
- `createEchoExecutor()` — a deterministic, non-AI reference `Executor` used by this
  package's own tests and by `examples/protocol-demo` to prove the architecture end to end.
- `createRuntime({ executor })` — orchestrates one `Run`: emits `run.started`, drives the
  executor, translates its output into `message.started` / `message.delta` / `message.end`
  events, and emits `run.completed` / `run.failed` / `run.cancelled`.

## Public API

See `src/index.ts`. No deep imports into `src/` are supported (the package's `exports`
field only exposes `.`).

## Dependencies

- `@aicopilot/protocol` — the only workspace dependency, per the dependency-direction rule
  in `docs/architecture/overview.md` (`core → protocol`, never the reverse).

## Non-responsibilities

- **No LLM runtime.** `Executor` is intentionally generic; Phase 2's `ai-runtime` skill
  owns the actual model/provider abstraction, retries, timeouts, and token accounting.
- **No transport.** HTTP/SSE/WebSocket belong to `@aicopilot/server` / `@aicopilot/client`.
- **No multi-subscriber event fan-out.** A `RuntimeRun.events` iterable is single-use and
  single-consumer; iterating it a second time throws. Broadcasting one run's events to
  multiple independent subscribers is out of scope for Phase 1.
- **No persistence.** Run/event state exists only for the lifetime of the async generator
  driving it; nothing is written to a database (`@aicopilot/server` will decide whether/how
  to persist runs when it needs to, e.g. for the cancel-by-id endpoint's run registry).
- **`createEchoExecutor` is a test/demo fixture, not a production component** — it must
  never be used as a template for a real model integration.

## Basic Usage

```ts
import { createRuntime, createEchoExecutor } from '@aicopilot/core';

const runtime = createRuntime({ executor: createEchoExecutor() });
const run = runtime.run({
  message: { role: 'user', content: [{ type: 'text', text: 'Hello protocol' }] },
});

for await (const event of run.events) {
  console.log(event.type);
}
```
