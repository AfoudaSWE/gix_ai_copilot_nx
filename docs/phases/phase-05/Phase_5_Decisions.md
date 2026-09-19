# Phase 5 Decisions

Full reasoning lives in [ADR 0010](../../adr/0010-canonical-tool-architecture.md). This page
summarizes the decisions and the smaller ones that didn't rise to ADR-worthy.

## ADR 0010 summary

1. `@gixcopilot/tools` depends only on `@gixcopilot/protocol` (+ `zod`) — never React, never
   Fastify, never a provider SDK, never `core`.
2. Tool identity is a single namespaced dot-name; no separate `namespace` field.
3. `ToolDefinition.execute` uses method shorthand deliberately, for bivariant parameter
   checking that allows heterogeneous storage in a registry without an `any` escape hatch.
4. Duplicate tool registration is rejected by default; `{ replace: true }` opts in.
5. `ToolResolver` is a mandatory discovery indirection — no call site wires
   `registry.list()` straight into a model request.
6. `ExecutorContext` gained an optional `onToolEvent` callback; `Executor.execute()`'s yield
   type is unchanged, preserving every Phase 1/2 `Executor` implementation untouched.
7. The backend Model → Tool → Model loop runs inside one `Executor.execute()` call — no new
   `RunStatus`.
8. A frontend tool call suspends on a `FrontendToolBridge` promise, resolved by the client's
   POST, run cancellation, or a timeout — not a new paused protocol state.
9. A frontend tool call is re-validated against its Zod schema on both the browser and (were
   it ever misrouted) the server side — zero trust applies identically on both ends.
10. `generateObject()` (structured output) is a distinct API from tool calling, built on the
    existing `ModelRuntime.stream()` path.

## Smaller decisions

- **Tool result serialization mirrors `@gixcopilot/context`'s approach but is not shared code.**
  Both packages solve "make an arbitrary value JSON-safe and bounded," but they are different
  domains (application context text vs. tool result payloads) and `@gixcopilot/tools` must
  not depend on `@gixcopilot/context` — the technique is documented as intentionally
  reimplemented, not an oversight.
- **Concurrency policy is intentionally coarse**: a batch runs fully parallel unless *any*
  call in it declares `serial`/`exclusive`, in which case the *whole* batch runs sequentially.
  No per-pair dependency graph, no distributed lock — the tool-system skill's explicit
  "don't overbuild" guidance, and there was no concrete requirement for finer granularity.
- **The `requested` tool lifecycle phase is the caller's responsibility, not `ToolRuntime`'s.**
  `ToolRuntime.execute()` only emits `started`/`completed`/`failed`, because "a call was
  requested" is known and meaningful *before* resolution/dispatch — the tool-calling executor
  (which receives the model's tool call first) announces it, then hands off to the runtime.
- **`ToolRuntime` never emits any lifecycle event for `TOOL_NOT_FOUND`/`TOOL_DISABLED`.**
  These are resolution-time rejections, not execution attempts — there was never a "start" to
  report. A test in `tool-runtime.spec.ts` pins down this exact behavior so it isn't
  accidentally "fixed" into inconsistency later.
- **The empty-string flush (`yield ''`) is treated as a documented internal mechanism, not a
  public API.** No public type or documentation encourages a host-authored `Executor` to rely
  on this trick; it exists specifically because `@gixcopilot/server`'s own tool-calling
  executor needs a flush point before a blocking await, and suppressing the resulting no-op
  event at the `runtime.ts` level keeps it invisible to every consumer.
- **The OpenAI adapter's tool-calling support is unit-tested with a fake client, not a live
  smoke test**, following the exact convention every other Phase 2+ OpenAI test in this
  repository already uses (`fetch`/`client` injection) — no new test infrastructure needed.
- **No dependency was added to any *existing* package.** `zod` was added to
  `@gixcopilot/provider` (provider-core) and `@gixcopilot/react`, both of which already
  transitively used a pinned Zod version elsewhere in the workspace (`packages/protocol`,
  `packages/server`) — same version (`4.6.5`), not a new choice.
