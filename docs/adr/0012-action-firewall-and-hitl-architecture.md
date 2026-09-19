# ADR 0012: AI Action Firewall & Human-in-the-Loop Architecture

## Status

Accepted (Phase 7).

## Context

Phases 1–6 built a system that can understand application context, reason with a real model,
choose tools, execute backend/frontend actions, render trusted generative UI, and let a model
propose changes to shared application state. None of that path asked whether the *caller* was
allowed to do any of it — Phase 5's `ToolRuntimeMiddleware` extension point existed
specifically for a future security layer to plug into (see `docs/phases/phase-05/
Phase_5_Architecture.md`'s "Future Action Firewall Checkpoint"), but nothing occupied it.
Phase 7 had to add that layer without redesigning anything Phases 1–6 already shipped, and
without ever making enforcement optional in a way that could be silently bypassed.

## Decisions

### 1. A new, framework-independent `@gixcopilot/security` package

Mirrors `@gixcopilot/tools`' and `@gixcopilot/context`'s existing pattern: depends only on
`@gixcopilot/protocol` and `@gixcopilot/tools` (for `AnyToolDefinition`/`ToolResolver` types
in its discovery helper), never on React, Fastify, or a provider SDK. It is consumed by
`@gixcopilot/server`; React/UI never import it directly for runtime logic — approval state on
the client is built entirely from protocol-level event types (`ToolApprovalLevel`,
`ToolActionPreview`, the four `approval.*` events), so a headless consumer never needs a
`@gixcopilot/security` dependency at all.

### 2. The canonical enforcement boundary is `@gixcopilot/server`'s dispatch step, not `ToolRuntimeMiddleware`

Phase 5's own middleware hook only wraps `ToolRuntime.execute()`, which only ever runs
*backend* tool calls. A frontend tool call never reaches `ToolRuntime` at all — it suspends on
`FrontendToolBridge` instead. Relying on `ToolRuntimeMiddleware` alone would leave every
frontend tool call, and every direct (non-model) action invocation, unprotected. The firewall
is therefore evaluated in the tool-calling executor's own dispatch step, which is the one
place backend calls, frontend calls, and reserved Generative UI/state-patch calls (themselves
ordinary registered tools since Phase 6) all converge before they execute — and, as defense in
depth (the tool-system skill's "always re-authorize at execution time"), the same firewall is
*also* wired as a `ToolRuntimeMiddleware` around the actual `ToolRuntime.execute()` boundary,
so a caller that somehow reached `ToolRuntime` through a different path than the executor
still cannot bypass authorization.

### 3. Two-pass dispatch, to get an approval prompt to the client before blocking

An approval can take minutes for a human to resolve. The executor's async generator only
flushes buffered `tool.*`/`approval.*` events to the client at its own `yield` points (the
same mechanism Phase 5 built for frontend tool calls). Evaluating the firewall and awaiting a
human decision in the same pass a naive implementation might attempt would mean the
`approval.requested` event sits unflushed in memory for the entire wait — the human would
never see the prompt. Pass 1 evaluates every call in a batch, creates any needed
`ApprovalRequest`, and announces `tool.requested`/`approval.requested`/an immediate denial for
all of them, entirely before the batch's one flush point. Pass 2 performs the actual blocking
work (awaiting a frontend result, awaiting a human decision, executing a backend tool).

### 4. Direct (non-model) action invocation is a real server round trip, not a client-only shortcut

Phase 6's `useInvokeTool()` originally executed a registered frontend tool purely client-side,
by design, for the "a generated component's own button" case (Section 32-35). Phase 7 extends
this: when a firewall is configured, invoking an action goes to the server as a `client.run()`
call carrying a single pre-built `action: {name, arguments}` instead of a model turn — the
executor pushes it directly into the same `toolCallsThisTurn` array a model-requested call
would populate, so it flows through identical firewall/approval/execution logic. A button
click can no longer bypass the firewall merely by not involving a model.

### 5. Revalidation reuses `ActionFirewall.evaluate()`, marked `revalidation: true`

Section 42/44 requires re-evaluating security after a human decision, not treating approval as
a permanent bypass token. Calling `evaluate()` a second time is sufficient — there is no
separate `revalidate()` method — but two adjustments were necessary: the risk/approval-level
computation is stateless and always re-derives the same-or-related approval requirement, so a
second `'approval'` result is compared against the already-granted level (`strongerApprovalLevel`)
rather than treated as an automatic denial; and rate limiting is skipped on a
`revalidation: true` call so resuming an approved action never consumes a second rate-limit
unit for the same original request.

### 6. Approval data policy and dry-run/preview freshness

A dry-run preview is produced once, at approval-request time, and attached to the
`ApprovalRequest`/`approval.requested` event so an Approval UI never needs a second round
trip. At resume time, if the tool declares `dryRun`, the preview is regenerated and compared
to the one a human actually approved (Section 45's "do not blindly execute stale approved
actions") — a mismatch denies with `POLICY_DENIED` rather than executing against a resource
that changed underneath the approval.

### 7. PII redaction at the `DataPolicy` boundary, applied symmetrically

A `DataPolicy` (`createFieldRedactionDataPolicy` or a custom implementation) is applied to a
successful backend tool result before it becomes both the `tool.completed` event's payload
*and* the tool-result message the model itself receives — the model must never see privileged
data the client isn't shown either. The same policy's `redactText` is applied to Phase 4
context content before it is serialized into the leading system message, closing Section 55's
model-data-policy requirement without `@gixcopilot/context` taking on any `@gixcopilot/
security` dependency (the option is typed structurally as `{ redact(data: unknown): unknown }`
in `ContextEngineOptions`, not imported).

## Consequences

- No `protocol`/`core`/`client`/`server` package needed a breaking change — every extension
  (`ToolManifestEntry.security`, four new `approval.*` events, new `CopilotErrorCode`s, the
  optional `action` field on a run request) is additive, so every Phase 1–6 request/response
  shape keeps working unmodified.
- A server that never configures `actionFirewall` behaves exactly as it did in Phase 5/6 —
  the firewall is opt-in per `createServer()` call, not a forced dependency.
- Approval state is held in-memory per server process (`createInMemoryApprovalStore`), the
  same documented limitation as the pre-existing run registry and frontend-tool bridge (see
  `docs/TECHNICAL_DEBT.md`) — a multi-instance deployment needs a shared store, out of scope
  for this phase.
