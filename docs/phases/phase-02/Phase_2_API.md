# Phase 2 API Changes

## New Public APIs

### `@aicopilot/protocol`

- `FinishReason` — `'stop' | 'length' | 'content_filter' | 'cancelled' | 'error' | 'unknown'`
- `CopilotErrorCode` extended: `MODEL_ERROR`, `PROVIDER_ERROR`, `AUTHENTICATION_ERROR`,
  `RATE_LIMITED`, `MODEL_NOT_FOUND`, `CONTEXT_LIMIT_EXCEEDED`, `TIMEOUT`, `NETWORK_ERROR`
- `CopilotError` static factories: `.model()`, `.provider()`, `.authentication()`,
  `.rateLimited()`, `.modelNotFound()`, `.contextLimitExceeded()`, `.timeout()`,
  `.networkError()`
- `RunCompletedEvent.finishReason?: FinishReason` (optional)

### `@aicopilot/core`

- `ExecutorCompletion` — `{ usage?: Usage; finishReason?: FinishReason }`

### `@aicopilot/provider` (new package)

- Types: `ModelMessage`, `ModelReference`, `ModelRequest`, `ModelStreamEvent`,
  `ModelStreamEventType`, `ModelExecutionOptions`, `ModelProvider`, `ModelProviderRegistry`,
  `RetryPolicy`, `ModelLatency`, `ModelRuntimeTelemetryEvent`,
  `ModelRuntimeTelemetryListener`, `ModelExecutionRequest`, `ModelRuntime`,
  `ModelRuntimeDefaults`, `CreateModelRuntimeOptions`, `CreateModelExecutorOptions`
- Functions: `createModelProviderRegistry()`, `computeBackoffDelayMs()`, `sleep()`,
  `createModelRuntime()`, `createModelExecutor()`
- Constants: `DEFAULT_RETRY_POLICY`

### `@aicopilot/provider-mock` (new package)

- `createMockProvider(options?)`, `MockFailure`, `MockProviderOptions`,
  `MockProviderScenario`, `MockProviderScenarioInput`

### `@aicopilot/provider-openai` (new package)

- `createOpenAIProvider(options?)`, `CreateOpenAIProviderOptions`
- `toNormalizedError()`, `mapFinishReason()`, `toOpenAIMessage()`, `toOpenAIMessages()`

## Changed Public APIs (breaking, pre-1.0)

| API                                       | Before (Phase 1)                  | After (Phase 2)                                                                  |
| ----------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------- |
| `@aicopilot/core` `Executor.execute()`    | returns `AsyncIterable<string>`   | returns `AsyncGenerator<string, ExecutorCompletion \| void, undefined>`          |
| `@aicopilot/core` `ExecutorInput`         | `{ threadId, message }`           | `{ threadId, messages }`                                                         |
| `@aicopilot/core` `RunOptions`            | `{ threadId?, message, signal? }` | `{ threadId?, messages, signal? }`                                               |
| `@aicopilot/core` `cancellable<T>()`      | fixed `TReturn = void`            | generic `cancellable<T, TReturn = void>()`, propagates the source's return value |
| `@aicopilot/server` request body          | `{ threadId?, message }`          | `{ threadId?, model?, messages }`                                                |
| `@aicopilot/server` `CreateServerOptions` | `{ runtime, logger? }`            | `{ runtime, modelRuntime?, logger? }`                                            |
| `@aicopilot/client` `RunOptions`          | `{ threadId?, message, signal? }` | `{ threadId?, model?, messages, signal? }`                                       |
| `@aicopilot/client` `TransportRunRequest` | `{ threadId?, message, signal? }` | `{ threadId?, model?, messages, signal? }`                                       |

All changes are pre-1.0/unpublished-package churn, not a SemVer break against a real
consumer — see `docs/adr/0006-model-provider-abstraction.md`'s "Consequences" section and
the backward-compatibility skill.

## Unchanged

- Every Phase 1 protocol event shape is otherwise identical; `finishReason` is additive and
  optional. A Phase 1 client that has never heard of `finishReason` still parses every
  event correctly.
- `@aicopilot/client`'s and `@aicopilot/server`'s behavior for a request with no `model`
  field is byte-for-byte the same as Phase 1 (verified by the unmodified `protocol-demo`
  integration suite still passing).
