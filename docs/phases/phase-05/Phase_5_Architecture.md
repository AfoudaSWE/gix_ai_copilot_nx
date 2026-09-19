# Phase 5 Architecture — Tools & Agent Actions

## Package boundary

```text
@gixcopilot/protocol   (unchanged position; additive types only)
        ↑
        │
@gixcopilot/tools       (NEW — framework-independent, depends only on protocol)
        ↑
   ┌────┴─────────────────┐
   │                       │
@gixcopilot/server     @gixcopilot/react
(+ provider, core)     (+ client, context)
```

`@gixcopilot/tools` is a leaf package: `ToolDefinition`, `defineTool`, the registry, the
resolver, and the execution runtime. It has **zero** dependency on React, Fastify, a
provider SDK, or any transport. `@nx/enforce-module-boundaries` encodes this:
`scope:tools → [scope:protocol, scope:tools]` only; `scope:server` and `scope:react` were
each extended to additionally allow `scope:tools`.

Backend (native) tools are registered directly into a `ToolRegistry` the server app author
owns and passes to `createServer({ toolRegistry })`. Frontend tools are registered into a
*separate*, per-`CopilotProvider` `ToolRegistry` instance living inside `@gixcopilot/react`'s
internals (mirroring `@gixcopilot/context`'s per-provider isolation from Phase 4) — the same
canonical `ToolDefinition`/`defineTool`/`ToolRegistry` types back both, distinguished only by
`metadata.executionLocation` (`'server' | 'client'`) and `metadata.source`
(`'native' | 'frontend'`, with `'openapi' | 'mcp' | 'agent'` reserved for later phases).

## Canonical tool definition

```ts
interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;                              // namespaced dot identity, e.g. "applications.getStatus"
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema?: z.ZodType<TOutput>;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
  metadata?: ToolMetadata;                   // category, tags, source, executionLocation,
                                              // readOnly, destructive, idempotent, riskClass,
                                              // timeoutMs, concurrency, sensitivity, custom
  enabled?: boolean | (() => boolean);
}
```

`execute` is declared with method shorthand, not a property of type
`(input, ctx) => Promise<T>` — this makes TypeScript check its parameter **bivariantly**,
which is what lets a `ToolDefinition<Specific, Specific>` be stored in a
`ToolRegistry`/`AnyToolDefinition` collection (a heterogeneous list of differently-typed
tools) without an `any`/unsafe-cast escape hatch. `defineTool()`'s own public signature stays
fully strict; only the already-built `ToolDefinition`'s storage shape uses this technique.
Identity is the `name` alone (dot-namespaced, e.g. `applications.getStatus`) — no separate
`namespace`/`version` field to keep in sync.

## Tool registry, resolver, runtime

```text
ToolDefinition
      │ register()
      ▼
ToolRegistry            (register/unregister/get/list/subscribe/clear; duplicate names
                          rejected by default, { replace: true } opts in)
      │ resolve(context)
      ▼
ToolResolver             (discovery boundary — Section 65/66: a Phase 7 permission-aware
                          resolver, or a Phase 8 OpenAPI/MCP-backed one, plugs in here
                          without the registry or runtime ever changing)
      │
      ▼
ToolRuntime.execute(request)
      │
      ▼
resolve → validate input (Zod) → middleware chain → timeout/cancellation race
   → execute → validate output (Zod, if declared) → serialize/bound result
   → normalized ToolResult { status: 'success' | 'error' }
```

`createToolRuntime({ resolver, middleware?, defaultTimeoutMs?, resultSerialization?, onEvent? })`
never throws: every failure (unknown tool, disabled tool, invalid arguments, a thrown error,
invalid output, timeout, cancellation) becomes a `ToolResult` with `status: 'error'`, so a
caller (the server's tool-calling executor, or a browser's own execution path) always has a
value to feed back to the model. `onEvent` reports `started`/`completed`/`failed` — the
`requested` phase is the *caller's* responsibility (see below), since it's known before
resolution/dispatch happens.

Middleware is an onion-model pipeline (`(invocation, next) => Promise<ToolResult>`), the
explicit boundary a Phase 7 Action Firewall (auth/RBAC/ABAC/approval/audit) will wrap around
without this runtime changing shape — see [Decisions](Phase_5_Decisions.md).

## Protocol additions (all additive)

```text
protocol/tool.ts (new)
  ToolSource            'native' | 'frontend' | 'openapi' | 'mcp' | 'agent'
  ToolExecutionLocation 'server' | 'client'
  ToolCall              { id, name, arguments }
  ToolResult            { status:'success', toolCallId, data } | { status:'error', toolCallId, error }
  ToolLifecycleEvent    { phase:'requested'|'started'|'completed'|'failed', ... }
  ToolManifestEntry     { name, description, parameters (JSON Schema), executionLocation }

message.ts   ContentPart += 'tool_call' (on an assistant message) | 'tool_result' (on a tool message)
finish-reason.ts  FinishReason += 'tool_calls'
errors.ts    CopilotErrorCode += TOOL_NOT_FOUND, TOOL_DISABLED, TOOL_EXECUTION_ERROR,
             TOOL_OUTPUT_INVALID, TOOL_ITERATION_LIMIT_EXCEEDED, FRONTEND_TOOL_UNAVAILABLE
             (argument/cancellation/timeout reuse the existing VALIDATION_ERROR/CANCELLED/TIMEOUT codes)
events.ts    CopilotEvent += tool.requested | tool.started | tool.completed | tool.failed
```

No existing protocol field was renamed or repurposed; `RunStatus` and `MessageRole` are
unchanged (`'tool'` already existed as a role value since Phase 1). Backend tool round trips
never leave a `Run` in a new status — the whole Model → Tool → Model loop happens inside one
`Executor.execute()` call (see below), so the run is simply `running` throughout, exactly as
before Phase 5.

## Extending `@gixcopilot/core` without a breaking change

The Phase 5 requirement to interleave tool lifecycle notifications with an `Executor`'s text
deltas is met **without widening `Executor.execute()`'s yield type** (still plain
`AsyncGenerator<string, ExecutorCompletion | void, undefined>` — every Phase 1/2 `Executor`,
including `createEchoExecutor`, is untouched):

```ts
interface ExecutorContext {
  readonly runId: RunId;
  readonly signal: AbortSignal;
  readonly onToolEvent?: (event: ToolLifecycleEvent) => void;   // NEW, optional
}
```

An executor that performs its own tool-calling loop internally calls `context.onToolEvent(...)`
synchronously; `@gixcopilot/core`'s `runtime.ts` queues these and drains them into real
`tool.*` `CopilotEvent`s at the next point its own generator naturally resumes (after each
`deltaIterator.next()` call, and — a fixed regression, see [Testing](Phase_5_Testing.md) —
also in the `catch` block, so an event queued just before a thrown error is never silently
lost). This mirrors Phase 2's own precedent of extending `ExecutorCompletion` with
`usage`/`finishReason` rather than changing `execute()`'s shape.

One further consequence: `@gixcopilot/server`'s tool-calling executor sometimes needs to
force a drain *before* a long-blocking `await` (see "Frontend tool transport" below); it does
so by yielding an empty string (`yield ''`). An empty delta carries no information for a
client, so `runtime.ts` suppresses it entirely rather than emitting a no-op `message.delta` —
this flush mechanism is fully invisible to protocol consumers.

## Provider-neutral tool calling

```text
@gixcopilot/provider (provider-core) additions:
  ModelToolDefinition        { name, description, parameters: JSON Schema }
  ModelRequest.tools?        readonly ModelToolDefinition[]           (additive, optional)
  ModelExecutionRequest.tools?  same, on the runtime-facing request
  ModelStreamEvent += { type: 'tool_call.requested', toolCall: ModelToolCall }
  ToolCallAssembler          accumulates fragmented streamed tool-call argument deltas
                             (Section 38) into one ModelToolCall - used by provider-openai
```

`createModelExecutor` (the plain, non-tool-calling bridge into `@gixcopilot/core`) never
sends `tools`, so a `tool_call.requested` event reaching it is unexpected; its exhaustive
switch throws an internal error rather than silently discarding it — a real tool-calling
request must use `@gixcopilot/server`'s `createToolCallingExecutor` instead.

`@gixcopilot/provider-mock`'s `MockProviderScenario` gained an optional `toolCalls` field
(Section 73): a scripted scenario can deterministically request one or more tool calls (after
any scripted `chunks`), then completes with `finishReason: 'tool_calls'`.

`@gixcopilot/provider-openai` maps `ModelToolDefinition[]` to OpenAI's `tools` function-
calling shape, assembles streamed `delta.tool_calls` fragments via `ToolCallAssembler`, and
maps an assistant message's `tool_call` content parts / a `tool`-role message's `tool_result`
part to and from OpenAI's own `tool_calls`/`tool` message shapes (previously an explicit
`VALIDATION_ERROR` placeholder — see `message-mapping.ts`'s Phase 2 comment, now replaced).

## The Model → Tool → Model loop (backend tools)

```text
createToolCallingExecutor({ modelRuntime, model, backendToolResolver, frontendTools,
                             frontendToolBridge, maxToolIterations?, ... })
                             : Executor        (implemented in @gixcopilot/server)

execute(input, context):
  messages := input.messages
  loop (bounded by maxToolIterations, default 8):
    manifest := toToolManifest(resolve(backendToolResolver)) ++ frontendTools
    stream modelRuntime.stream({ ..., tools: manifest })
      content.delta      → yield text (unchanged client-visible behavior)
      tool_call.requested → collect
      model.completed     → capture usage/finishReason
      model.failed         → throw (normalized CopilotError)
    if no tool calls this turn: return { usage, finishReason }
    iterations += 1; over the limit → throw TOOL_ITERATION_LIMIT_EXCEEDED
    append an assistant message with tool_call content parts
    announce every call's 'requested' phase, then `yield ''` (flush point - see above)
    dispatch all calls (parallel-safe by default; `runWithConcurrencyPlan` runs the whole
      batch sequentially if any call's tool metadata declares 'serial'/'exclusive')
      - server-executed → @gixcopilot/tools' ToolRuntime.execute()
      - client-executed → suspend on `frontendToolBridge.awaitResult()` (see below)
    append a tool-role message with a tool_result content part per call
    loop again (call the model with the tool result(s) now in context)
```

`@gixcopilot/server`'s `buildRun()` only takes this path when the server was configured with
a `toolRegistry` or the request declares frontend tools; otherwise it uses the unmodified
Phase 2 `createModelExecutor` — a request with genuinely zero tools produces byte-identical
behavior either way (verified by test), so this is a safe, low-risk default.

## Frontend tool transport (Section 45, 50-51)

```text
Client (React)                          Server
──────────────                          ──────
useFrontendTool() registers a
ToolDefinition into a per-provider
ToolRegistry (metadata.executionLocation
= 'client')
        │
CopilotProvider builds a wire-safe
ToolManifestEntry[] (JSON Schema only,
no Zod instance) and sends it as
`tools` on every run request  ────────► POST /runs { ..., tools }
                                                 │
                                         tool-calling executor merges backend +
                                         client-declared manifest, offers both to
                                         the model
                                                 │
                                         model requests a tool the manifest says is
                                         'client'-executed
                                                 │
                                         dispatchOne(): onToolEvent('requested', source:
                                         'frontend') + onToolEvent('started'), THEN
                                         suspends on frontendToolBridge.awaitResult()
                                                 │
      ◄───────────────────────────────  tool.requested SSE event (flushed via the
      chat-store receives tool.requested,       `yield ''` point above - critical: without
      looks up the tool in its OWN registry,    it, the event and the wait for its answer
      executes it through a local ToolRuntime   would deadlock inside one unresolved
      (same validate → execute → serialize      `execute()` step - see Testing.md)
      pipeline as the backend)
        │
      client.submitToolResult(runId, toolCallId, result)
        │
        └──────────────────────────────► POST /runs/:runId/tool-results { toolCallId, result }
                                                 │
                                         frontendToolBridge.submitResult() resolves the
                                         suspended awaitResult() promise
                                                 │
                                         dispatch continues; tool.completed/tool.failed
                                         flushed on the next drain; loop calls the model
                                         again with the tool result in context
```

`FrontendToolBridge` (`@gixcopilot/server/src/frontend-tool-bridge.ts`) is an in-memory,
process-local map keyed by `${runId}:${toolCallId}` (mirrors `RunRegistry`'s own documented
limitation), resolved by either: the client's POST, the run's own `AbortSignal` firing
(mapped to a `CANCELLED` `ToolResult`), or an optional `frontendToolTimeoutMs` elapsing with
neither (mapped to `FRONTEND_TOOL_UNAVAILABLE`, Section 51) — a disconnected/unresponsive
client can never hang a run indefinitely.

The client never trusts the model's arguments just because they arrived over SSE: the
browser's own `ToolRuntime.execute()` re-validates them against the registered tool's Zod
`inputSchema` before `execute()` ever runs (Section 62's zero-trust rule applies identically
on both sides of the wire).

## Structured outputs (distinct from tool output)

```ts
generateObject({ runtime, model, messages, schema, ... }): Promise<{ object: z.infer<Schema> }>
```

Lives in `@gixcopilot/provider` (provider-core), built on the same `ModelRuntime.stream()`
every other call goes through — no parallel "structured mode" request path. The caller asks
directly for one JSON value matching `schema`; there is no tool name and no model-initiated
round trip, which is the explicit distinction Section 42 requires from tool calling. Invalid
JSON or schema-mismatched JSON is a `CopilotError.validation` rejection, never a best-effort
partial object.

## Tool activity UI (Section 59-61)

```text
tool.* CopilotEvents
      │
chat-store.ts (React) tracks a per-run `toolCalls: ToolCallState[]` timeline
(cleared at the start of every new run), reset/updated by the same tool.* events
      │
useToolCalls()  (headless hook, @gixcopilot/react)
      │
<ToolActivity toolCalls labels />  (@gixcopilot/ui, default renderer; overridable via
                                     `components.ToolActivity`)
```

The default `ToolActivity` renderer shows only a tool's `name` and lifecycle status
("Running X…" / "✓ X completed" / "✗ X failed") — it never renders raw `arguments`/`result`
by default (Section 60/62); a host that wants richer per-tool rendering overrides the slot
entirely and can read `arguments`/`result` itself from the same headless `ToolCallState`.

## Future-phase compatibility checkpoints (documented, not implemented)

```text
                CANONICAL TOOL SYSTEM
                        │
             ┌──────────┴──────────┐
             ▼                     ▼
          Backend               Frontend      (Phase 5 — implemented)
                        │
                        ▼
                  ToolDefinition
                        │
                        ▼
                  Tool Registry ──── ToolResolver (discovery boundary)
                        │
                        ▼
                  Tool Runtime ──── middleware pipeline (interception boundary)

Future (Phase 8, not implemented):        Future (Phase 7, not implemented):
  OpenAPI operation ─┐                      Tool Call
  MCP tool ──────────┼──► ToolDefinition       │
                     │                       Authentication
                     ▼                       Authorization / RBAC / ABAC
              Tool Registry                  Approval (HITL)
                                              Audit
                                                │
                                              Tool Runtime middleware pipeline (exists now)
```

- **OpenAPI → ToolDefinition**: an OpenAPI operation has a name, description, and a JSON
  Schema for its parameters/response — exactly `ToolDefinition`'s shape. A future adapter
  need only produce `{ name, description, inputSchema, outputSchema, execute }` and call
  `registry.register()`; nothing about the registry or runtime needs to change.
- **MCP → ToolDefinition**: identical shape argument — an MCP tool already carries a JSON
  Schema; a future adapter maps it the same way.
- **Action Firewall (Phase 7)**: the `ToolRuntimeMiddleware` boundary
  (`(invocation, next) => Promise<ToolResult>`) is exactly the interception point Section 70
  requires; no security middleware is implemented in Phase 5.
- **Permission-aware discovery (Phase 7)**: `ToolResolver` is the abstraction `registry.list()`
  is never bypassed for — a future resolver wraps or replaces `createDefaultToolResolver`
  without the registry, runtime, or any call site needing to change.

None of the above is implemented; `metadata.custom`/`metadata.sensitivity`/`metadata.riskClass`
exist as classification/extension points only and are never treated as enforcement (Section
16, 63) — see [Decisions](Phase_5_Decisions.md) and [Issues](Phase_5_Issues.md).
