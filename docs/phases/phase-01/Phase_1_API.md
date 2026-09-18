# Phase 1 API

The public API surface Phase 1 established (all still current, with the additive Phase 2
changes noted where relevant — see `docs/phases/phase-02/Phase_2_API.md` for those).

## `@gixcopilot/protocol`

- Types: `Message`, `MessageRole`, `ContentPart`, `Thread`, `Run`, `RunStatus`, `Usage`,
  `CopilotEventBase`, `RunStartedEvent`, `RunCompletedEvent`, `RunFailedEvent`,
  `RunCancelledEvent`, `MessageStartEvent`, `MessageDeltaEvent`, `MessageEndEvent`,
  `ErrorEvent`, `CopilotEvent`, `CopilotEventType`, `UnknownCopilotEvent`,
  `CopilotErrorCode`, `CopilotErrorMetadata`, `CopilotErrorOptions`, `PublicCopilotError`,
  `ParsedEvent`, `ProtocolVersion`, `ThreadId`, `RunId`, `MessageId`, `EventId`
- Functions: `createThreadId()`, `createRunId()`, `createMessageId()`, `createEventId()`,
  `asThreadId()`, `asRunId()`, `createEmptyUsage()`, `addUsage()`, `parseEvent()`,
  `serializeEvent()`, `isSupportedProtocolVersion()`
- Classes: `CopilotError` (with static factories `.validation()`, `.protocol()`,
  `.transport()`, `.cancelled()`, `.internal()`)
- Constants: `PROTOCOL_VERSION`

## `@gixcopilot/core`

- Types: `Executor`, `ExecutorContext`, `ExecutorInput`, `ExecutorMessageInput`,
  `EchoExecutorOptions`, `CreateRuntimeOptions`, `Runtime`, `RunMessageInput`, `RunOptions`,
  `RuntimeRun`
- Functions: `createEchoExecutor()`, `createRuntime()`, `cancellable()`
- Classes: `RunLifecycle`, `EventSequencer`

## `@gixcopilot/server`

- Functions: `createServer()`, `createRunRegistry()`, `formatSseFrame()`,
  `formatSseComment()`
- Types: `CreateServerOptions`, `RunRegistry`, `CreateRunRequestBody`
- Constants: `SSE_RESPONSE_HEADERS`
- Zod schemas: `createRunRequestSchema`, `cancelRunParamsSchema`
- HTTP API: `GET /health`, `POST /runs`, `POST /runs/:runId/cancel`

## `@gixcopilot/client`

- Functions: `createCopilotClient()`, `createSseTransport()`
- Types: `ClientMessageInput`, `ClientRun`, `CopilotClient`, `CopilotClientOptions`,
  `RunOptions`, `SseTransportOptions`, `CopilotTransport`, `TransportMessageInput`,
  `TransportRunRequest`

## Notes

- Every public export is re-exported from each package's `src/index.ts`; no deep imports
  into `src/` are supported (each package's `exports` field exposes only `.`).
- `RunOptions.message` (singular) on `@gixcopilot/core` and `@gixcopilot/client` was later
  renamed to `RunOptions.messages` (an array) in Phase 2 — see
  `docs/phases/phase-02/Phase_2_API.md`'s "Changed Public APIs" table. This document
  describes the API exactly as Phase 1 shipped it.
