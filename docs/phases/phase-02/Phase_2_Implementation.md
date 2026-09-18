# Phase 2 Implementation

## New Packages

- **`@aicopilot/provider`** (`packages/providers/provider-core`) — `ModelMessage`,
  `ModelReference`, `ModelRequest`, `ModelStreamEvent`, `ModelProvider`,
  `createModelProviderRegistry`, `RetryPolicy` + `computeBackoffDelayMs`/`sleep`,
  `ModelLatency`, `ModelRuntimeTelemetryEvent`, `createModelRuntime`,
  `createModelExecutor`.
- **`@aicopilot/provider-mock`** (`packages/providers/mock`) — `createMockProvider`, with
  scenario-based (or per-attempt-function) control over chunks, delay, failures (before
  first chunk / mid-stream), usage, and finish reason.
- **`@aicopilot/provider-openai`** (`packages/providers/openai`) — `createOpenAIProvider`,
  `toOpenAIMessage(s)`, `toNormalizedError`, `mapFinishReason`.
- **`examples/model-streaming`** — CLI demo (mock by default, optional real OpenAI) plus
  the mandatory mock integration test and the optional real-provider smoke test.

## Changed Packages

- **`@aicopilot/protocol`**:
  - Added `FinishReason` (`finish-reason.ts`).
  - Extended `CopilotErrorCode` with 8 model/provider-related codes and matching
    `CopilotError` static factories (`model`, `provider`, `authentication`, `rateLimited`,
    `modelNotFound`, `contextLimitExceeded`, `timeout`, `networkError`).
  - Added optional `RunCompletedEvent.finishReason`; updated its Zod schema
    (`z.literal`/`z.enum` additions) and the `publicCopilotErrorSchema` code enum.
- **`@aicopilot/core`**:
  - `ExecutorInput.message` (singular) -> `ExecutorInput.messages` (array).
  - `Executor.execute()` return type: `AsyncIterable<string>` ->
    `AsyncGenerator<string, ExecutorCompletion | void, undefined>`.
  - `cancellable()` generalized to a generic `TReturn` (was hardcoded `void`), now
    propagates the source generator's return value.
  - `createRuntime`'s `generate()` now manually drives the executor's iterator (instead of
    a plain `for await`) to capture `ExecutorCompletion` and populate `run.completed`'s
    `usage`/`finishReason`.
  - `RunOptions.message` -> `RunOptions.messages`; `createEchoExecutor` echoes only the
    latest message (ignores earlier history, by design — see its README).
- **`@aicopilot/server`**:
  - `createRunRequestSchema`: `message` -> `messages` (array), added optional `model`.
  - `CreateServerOptions` gained optional `modelRuntime?: ModelRuntime`.
  - `POST /runs` now branches: no `model` -> the injected default `runtime`; `model`
    present -> `createModelExecutor` + a fresh `createRuntime` for that one run; `model`
    present but no `modelRuntime` configured -> `400 VALIDATION_ERROR`.
- **`@aicopilot/client`**:
  - `RunOptions.message` -> `RunOptions.messages`; added optional `model:
ClientModelReference` (a locally-defined `{ provider, model }`, not imported from
    `@aicopilot/provider` — the client never depends on that package).
  - `TransportRunRequest` and the SSE transport's JSON body assembly updated to match.
- **`examples/protocol-demo`**: updated for the `messages` rename (Phase 1 demo/tests
  otherwise unchanged — no model support added here, that's what `model-streaming` is for).

## Workspace/Tooling Changes

- `pnpm-workspace.yaml`: added the `packages/providers/*` glob.
- `tsconfig.json` (root): added references for the three new provider packages and the new
  example.
- `eslint.config.js`: added `scope:provider` and `scope:provider-adapter` tags/constraints;
  `scope:server` and `scope:example` constraints extended to allow the new scopes where
  appropriate.
- `tools/vitest.shared.ts`: added workspace aliases for the three new packages.
