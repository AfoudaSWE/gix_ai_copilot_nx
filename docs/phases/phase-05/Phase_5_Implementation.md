# Phase 5 Implementation Notes

## `@gixcopilot/tools` (new package)

| File | Responsibility |
| --- | --- |
| `tool-name.ts` | Namespaced dot-name validation (`applications.getStatus`); `isValidToolName`/`assertValidToolName`/`toolNamespaceOf`. |
| `tool-metadata.ts` | `ToolMetadata`, `ToolConcurrency`, `ToolRiskClass` — extensible, no enforcement fields. |
| `tool-definition.ts` | `ToolExecutionContext`, `ToolExecutor`, `ToolDefinition` (method-shorthand `execute` for bivariance), `AnyToolDefinition`, `isToolEnabled`. |
| `define-tool.ts` | `defineTool()` — full input/output type inference from Zod schemas via a generic that computes `TOutput` once and builds the object under an explicit, well-contained type annotation (no `any`). |
| `tool-registry.ts` | `createToolRegistry()` — Map-backed; register/unregister/get/list/subscribe/clear; duplicate names rejected unless `{ replace: true }`; `ToolRegistration.update()`/`dispose()`. |
| `tool-resolver.ts` | `ToolResolver`/`ToolResolutionContext`; `createDefaultToolResolver` (enabled-only), `createStaticToolResolver`, `combineToolResolvers` (first-resolver-wins de-dup by name). |
| `tool-schema.ts` | `toToolManifestEntry`/`toToolManifest` — Zod → JSON Schema via `z.toJSONSchema` (Zod 4 native, no new dependency). |
| `tool-result-serialization.ts` | `serializeToolResult()` — JSON-safe, size-bounded (`maxResultBytes`, default 32 KiB); handles `Date`/`bigint`/functions/circular refs without throwing. |
| `concurrency.ts` | `planConcurrency`/`runWithConcurrencyPlan` — a batch runs fully parallel only if every call is `parallel-safe` (the default); any `serial`/`exclusive` call forces the whole batch sequential. |
| `tool-runtime.ts` | `createToolRuntime()` — the execution pipeline: resolve → validate input → middleware → timeout/cancellation race → execute → validate output → serialize → normalize `ToolResult`; never throws. |
| `mock-tools.ts` | `mathAddTool`, `applicationsGetStatusTool` — deterministic tools for tests/examples (Section 71-72). |

## `@gixcopilot/protocol`

`tool.ts` (new) holds `ToolSource`, `ToolExecutionLocation`, `ToolCall`, `ToolResult`,
`ToolLifecycleEvent`, `ToolManifestEntry`. `message.ts`'s `ContentPart` union, `events.ts`'s
`CopilotEvent` union, `finish-reason.ts`'s `FinishReason`, and `errors.ts`'s
`CopilotErrorCode` were each extended additively (see [Architecture](Phase_5_Architecture.md)
for the exact list). `serialization.ts` gained matching Zod schemas and four new entries in
`eventSchemasByType`, keeping `parseEvent`'s three-way `known/unknown/invalid` forward-
compatibility contract intact for older clients.

## `@gixcopilot/core`

`executor.ts`: `ExecutorContext` gained an optional `onToolEvent` callback (see
Architecture's "Extending core" section) — `Executor.execute()`'s signature is unchanged.
`runtime.ts`: `generate()` now drains a `pendingToolEvents` queue (populated by
`onToolEvent`) both after every successful `deltaIterator.next()` **and** in the `catch`
block (a real bug found and fixed during Phase 5's own integration testing — see
[Testing](Phase_5_Testing.md)); it also suppresses an empty-string delta instead of emitting
a no-op `message.delta`, which is what lets a tool-calling executor force a flush point with
`yield ''` with zero visible protocol effect.

## `@gixcopilot/provider` (provider-core)

`model-tool.ts` (new): `ModelToolDefinition`. `model-request.ts`/`model-runtime.ts`: additive
optional `tools` field. `model-stream-event.ts`: additive `tool_call.requested` variant plus
the `ModelToolCall` shape. `tool-call-assembler.ts` (new): `ToolCallAssembler` — accumulates
`ToolCallDeltaFragment`s by index into fully-parsed `ModelToolCall[]`, throwing a
`CopilotError.validation` (never silently dropping) for an incomplete or malformed call.
`generate-object.ts` (new): `generateObject()`. `model-executor.ts`'s exhaustive switch
gained a `tool_call.requested` case that throws — this bridge is only ever used without
`tools` on the request, so a real provider producing this event here is a contract violation
worth failing loudly on. `model-runtime.ts`'s retry loop treats a `tool_call.requested` event
the same as `content.delta` for "don't retry after real progress" purposes.

## `@gixcopilot/provider-mock`

`MockProviderScenario.toolCalls` (optional): when set, emits one `tool_call.requested` per
entry (after any scripted `chunks`), then completes with `finishReason: 'tool_calls'` —
fully deterministic, no content-matching, matching every other scripted field's convention.

## `@gixcopilot/provider-openai`

`message-mapping.ts`: an assistant message's `tool_call` content parts map to OpenAI's
`tool_calls` field; a `tool`-role message's `tool_result` part maps to OpenAI's
`{ role: 'tool', tool_call_id, content }` shape (the Phase 2 placeholder that rejected any
`tool`-role message is gone). `openai-provider.ts`: maps `request.tools` to OpenAI's function-
calling `tools` param; assembles `choice.delta.tool_calls` fragments via `ToolCallAssembler`
and yields `tool_call.requested` once the stream signals `finish_reason: 'tool_calls'` or
ends. `error-mapping.ts`: OpenAI's `tool_calls`/`function_call` finish reasons now map to the
new `'tool_calls'` `FinishReason` (previously mapped to `'unknown'` with an explicit "Phase 5
will handle this" comment).

## `@gixcopilot/server`

`frontend-tool-bridge.ts` (new): `createFrontendToolBridge()` — the runId+toolCallId
correlation map described in Architecture. `tool-calling-executor.ts` (new):
`createToolCallingExecutor()` — the Model → Tool → Model loop, implemented as a single
`Executor` (see Architecture). `schemas.ts`: `createRunRequestSchema` gained an optional
`tools` field (client-declared frontend manifest); new `submitToolResultRequestSchema`/
`submitToolResultParamsSchema` for the new route. `app.ts`: `CreateServerOptions` gained
optional `toolRegistry`/`toolRuntimeDefaults`; `buildRun()` uses the tool-calling executor
only when a `toolRegistry` was configured or the request declares frontend tools — a request
with neither is provably byte-identical to pre-Phase-5 behavior (verified by test); a new
`POST /runs/:runId/tool-results` route submits a frontend tool's outcome to the bridge.

## `@gixcopilot/client`

`transport.ts`: `TransportRunRequest` gained optional `tools`; `CopilotTransport` gained
`submitToolResult()`. `sse-transport.ts`/`client.ts`: both implemented straightforwardly —
`tools` is included in the run POST body only when non-empty (preserving the exact prior
request body shape when nothing is registered, per Section 64's established convention).

## `@gixcopilot/react`

`internals.ts`: `CopilotInternals` gained `toolRegistry`/`toolRuntime` (both isolated per
`CopilotProvider` instance, mirroring `registry`/`stateStore`'s Phase 4 pattern).
`frontend-tool-hooks.ts` (new): `useFrontendTool()` — registers in an effect keyed by
`(toolRegistry, name)` (mirrors `useCopilotContext`'s convention exactly), with `execute`
read through a ref at call time so it always uses the calling component's current
closure/state (Section 48) without needing to re-register on every render.
`provider.tsx`: builds the per-run frontend manifest (`resolveToolManifest`, mirroring
`resolveContextMessage`'s "send nothing extra when nothing is registered" convention) and
exposes `useToolCalls()`. `chat-store.ts`: `ChatSnapshot` gained `toolCalls: ToolCallState[]`
(reset every run); `receive()` handles the four `tool.*` events, and a `tool.requested` event
with `source: 'frontend'` triggers `executeFrontendTool()` — validates via the local
`toolRuntime`, executes, and calls `client.submitToolResult()`; per-call `AbortController`s
are aborted on `stop()`/replacement so a stopped run never leaves a pointless in-flight
browser execution.

## `@gixcopilot/ui`

`components.tsx`: new `ToolActivity` component and `ToolActivityProps`; `CopilotComponents`
gained an optional `ToolActivity` slot; `ChatContent` renders it (backed by `useToolCalls()`)
and suppresses the generic `TypingIndicator` once any tool call is in flight, so only one
"is-working" indicator shows at a time. `labels.ts`: three new labels
(`toolRunning`/`toolCompleted`/`toolFailed`).

## `examples/react-tools` (new)

A deterministic, non-network `ModelProvider` (`backend.ts`) whose behavior is decided by
regex-matching the conversation's own text (Section 73's "mock model tool calling" pattern) —
no real LLM anywhere. Demonstrates all five required scenarios (backend tool, frontend tool,
context + tool, tool error, tool cancellation) against a real server and real HTTP/SSE client;
see [Testing](Phase_5_Testing.md).

## Design tradeoffs worth noting

- **Backend tool round trips never leave the run's status machine** — the whole loop is one
  `Executor.execute()` call, so no new `RunStatus` was needed. Frontend tool round trips
  suspend *inside* that same call via `await`, using the existing `AbortSignal`/timeout
  machinery rather than a new pause/resume protocol state.
- **The client re-validates frontend tool arguments** through the same `@gixcopilot/tools`
  `ToolRuntime` pipeline the server uses for backend tools, rather than calling `execute()`
  directly — zero-trust applies identically on both sides of the wire (Section 62).
- **Concurrency metadata only meaningfully governs backend dispatch ordering.** A frontend
  call's "execution" already happens client-side regardless of how the server awaits it;
  `runWithConcurrencyPlan` is applied uniformly to keep one code path, but the practical
  effect is scoped to backend tools sharing server-side resources.
