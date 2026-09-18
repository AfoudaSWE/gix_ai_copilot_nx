# @gixcopilot/provider-mock

## Purpose

A deterministic, non-network `ModelProvider` — no real AI, no network call, no API key.
This is what every other package's test suite (and the mock path of the model-streaming
example) is built on, so CI never needs provider credentials.

## Responsibilities

- `createMockProvider({ id?, scenario })` where `scenario` is either a fixed
  `MockProviderScenario` or a function of the 1-based attempt number (so a test can express
  "fails on attempt 1, succeeds on attempt 2" to exercise retry behavior).
- Supported scenarios: a normal chunked stream, a controlled per-chunk delay, failure
  before the first chunk, failure mid-stream after N chunks, optional usage, and a
  configurable (or defaulted) finish reason.
- Fully respects `ModelExecutionOptions.signal` — stops promptly on abort, at any point in
  the stream.

## Public API

See `src/index.ts`.

## Dependencies

- `@gixcopilot/protocol`, `@gixcopilot/provider` — nothing else. In particular, this package
  never depends on `@gixcopilot/provider-openai` (or any other adapter) — see the
  `scope:provider-adapter` module-boundary rule in the root `eslint.config.js`.

## Non-responsibilities

- **Not a stand-in for a real model's behavior or quality** — it only proves the
  architecture (streaming, cancellation, retry, error normalization) works; it does not
  simulate what a real LLM would actually say.
- **No persistence, no real token counting** — `usage` is whatever the scenario says it is,
  never computed.

## Basic Usage

```ts
import { createMockProvider } from '@gixcopilot/provider-mock';

const provider = createMockProvider({
  scenario: { chunks: ['Hello', ' world'], finishReason: 'stop' },
});
```
