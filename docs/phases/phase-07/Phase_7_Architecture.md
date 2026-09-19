# Phase 7 Architecture — Enterprise Security & HITL

## Package boundary

```text
@gixcopilot/security
  depends only on: @gixcopilot/protocol, @gixcopilot/tools
  never depends on: React, Angular, OpenAI/Anthropic SDKs, Fastify, PostgreSQL, MCP, OpenAPI
```

`@gixcopilot/security` is consumed by `@gixcopilot/server`. React/UI never depend on it at
runtime — the client-visible half of Phase 7 (`ApprovalState`, `useApprovals()`, the
`ApprovalCard`/`SecurityDenial` components) is built entirely from `@gixcopilot/protocol`
types (`ToolApprovalLevel`, `ToolActionRisk`, `ToolActionReversibility`, `ToolActionPreview`,
the four `approval.*` events), so a headless consumer never needs the security package at all.
See `docs/architecture/overview.md` for the full dependency-direction diagram.

## The Action Firewall pipeline

```text
                    ACTION REQUEST
                          │
                          ▼
                 AI ACTION FIREWALL
                          │
          ┌───────────────┼────────────────┐
          ▼               ▼                ▼
     Authentication   Authorization      Policy
    (context.identity)  (RBAC:           (ABAC/business,
                     requiredPermissions)  via PolicyRegistry)
          │               │                │
          └───────────────┼────────────────┘
                           ▼
                    Rate Limit (per identity+action,
                    skipped on revalidation)
                           ▼
                  Risk Classification
              (tool's declared risk/reversibility/
               explicit approval + any policy-escalated level)
                           ▼
              ┌───────────┼────────────┐
              ▼           ▼            ▼
            ALLOW        DENY       APPROVAL
              │                        │
              │                        ▼
              │                    INTERRUPT
              │                 (ApprovalRequest created,
              │                  run suspends via
              │                  ApprovalStore.awaitDecision)
              │                        │
              │                  Human Decision
              │                        │
              │                  APPROVE/REJECT
              │                        │
              │               REVALIDATE (evaluate()
              │                again, revalidation: true)
              │                        │
              └────────────┬───────────┘
                           ▼
                        EXECUTE
                           │
                           ▼
                         AUDIT
```

`ActionFirewall.evaluate(request, context)` (`packages/security/src/action-firewall.ts`) is a
single, pure-with-respect-to-approval-state function implementing every stage above except
approval creation itself, which the caller (the tool-calling executor) performs when it sees
a `'approval'` decision. Schema validation is deliberately not duplicated in the firewall — it
is `@gixcopilot/tools`' own responsibility, reused as-is (see the action-firewall skill's
explicit rule against a second, divergent validation implementation); the executor validates
a call's arguments against the tool's declared schema immediately after the firewall allows
or requires approval for it, before any approval request is created.

Every stage fails closed: an unauthenticated context denies with `AUTHENTICATION_REQUIRED`; a
missing permission denies with `PERMISSION_DENIED`; a policy that throws is treated as a
denial (`POLICY_DENIED`), never as an implicit allow; an unclassified action's risk defaults
to the strictest configured approval level, never to `'none'`.

## Enforcement boundary: why the dispatch step, not `ToolRuntimeMiddleware`

Phase 5's `ToolRuntimeMiddleware` extension point only wraps `ToolRuntime.execute()`, which
only ever runs *backend* tool calls — a frontend tool call suspends on `FrontendToolBridge`
instead and never reaches `ToolRuntime`. The firewall's canonical enforcement point is
therefore the tool-calling executor's own two-pass dispatch (`packages/server/src/
tool-calling-executor.ts`), which is the one place backend calls, frontend calls, and
reserved Generative UI/state-patch calls (themselves ordinary registered tools since Phase 6)
all converge before executing:

```text
Pass 1 (before the flush point)          Pass 2 (after the flush point)
────────────────────────────────         ──────────────────────────────
For every call in the batch:             For every plan:
  emit tool.requested (native/            if denied: return the precomputed
    reserved calls only - a frontend        error result
    call's tool.requested is deferred     if awaiting-approval: block on
    to Pass 2, see below)                   ApprovalStore.awaitDecision(),
  evaluate the firewall                     then revalidate, then fall
  if deny -> emit tool.failed,               through to normal dispatch
    record a 'denied' plan                if proceed/now-allowed: execute
  if approval -> dry-run preview,           (frontend bridge or
    create ApprovalRequest, emit            ToolRuntime.execute(), which
    approval.requested, record an           re-runs the firewall as a
    'awaiting-approval' plan                ToolRuntimeMiddleware for
  if allow -> record a 'proceed' plan        defense in depth)
yield '' (flushes every event above
  to the client in one step)
```

An approval can take minutes for a human to resolve; the executor's async generator only
flushes buffered protocol events to the client at its own `yield` points (the same mechanism
Phase 5 built for frontend tool calls). Evaluating the firewall and awaiting a human decision
in one undifferentiated pass would leave `approval.requested` unflushed in memory for the
entire wait — no human would ever see the prompt. This is why evaluation and announcement
happen in a first pass, entirely before the one flush point, and the actual blocking work
happens only in a second pass afterward. A frontend call's own `tool.requested` is deliberately
withheld until Pass 2, *after* authorization/approval succeeds — announcing it during Pass 1
would tell the browser to execute a call that might still be denied or pending approval.

Defense in depth (the action-firewall skill's "always re-authorize at execution time"): the
same firewall is *also* wired as a `ToolRuntimeMiddleware` around the real
`ToolRuntime.execute()` boundary a backend call eventually reaches, using a per-run `grants`
map (populated only once a human decision satisfies the approval level a call needed) so an
already-approved call is not asked to pause a second time. A caller that somehow reached
`ToolRuntime` through a different path than the executor's own dispatch still cannot bypass
authorization.

## Direct (non-model) action invocation

Phase 6's `useInvokeTool()` originally executed a registered frontend tool purely client-side
(the "a generated component's own button" case, Phase 6 Section 32-35). With a firewall
configured, invoking an action now goes to the server as a `client.run()` call carrying a
single `action: {name, arguments}` field instead of a model turn — the executor pushes this
directly into the same `toolCallsThisTurn` array a model-requested call would populate, so it
flows through identical firewall/approval/execution logic, satisfying the requirement that a
generated button cannot bypass the firewall merely by not involving a model:

```text
Button click (useInvokeTool)
        │
        ▼
client.run({ action: { name, arguments } })
        │
        ▼
Tool-calling executor (no model call - one synthetic
  ToolCall pushed directly into this turn's batch)
        │
        ▼
Action Firewall  ── identical to a model-requested call ──
        │
   ALLOW / DENY / APPROVAL
        │
        ▼
     Execute
```

## Human-in-the-loop state machine

```text
PENDING
   ├──→ APPROVED           (single-approver levels: first approve)
   ├──→ REJECTED           (any reject, at any point)
   ├──→ EXPIRED            (expiresAt reached, checked lazily and via a scheduled timer)
   └──→ CANCELLED          (the run was cancelled while this approval was pending)

For two-person:
PENDING
   ↓ (first distinct approver)
PARTIALLY_APPROVED
   ↓ (second distinct approver)
APPROVED
```

`packages/security/src/approval.ts` implements the transitions as pure functions
(`applyDecision`/`applyExpire`/`applyCancel`); `packages/security/src/approval-store.ts`'s
`createInMemoryApprovalStore()` is the stateful wrapper, including the run-pausing mechanism:
`awaitDecision(approvalId, { signal })` resolves once the approval reaches a terminal status,
rejects if `signal` aborts first (the tool-calling executor then cancels the approval and
returns a `CANCELLED` result), and an internal `setTimeout` proactively expires a request at
its `expiresAt` time even if nothing else ever queries it again — a human who never responds
does not leave the run hanging forever.

Approving the same request twice as the same identity, or rejecting after approval, is a
documented no-op (`applyDecision` returns the request unchanged once it is terminal, or once
that specific identity has already recorded an approve) — a duplicate button click or a race
between two browser tabs cannot execute an action twice or flip a resolved decision.

## Trust boundaries

```text
UNTRUSTED (validated the same way any external input would be)
  - LLM output: text, tool-call arguments, structured UI/state-patch requests
  - Model-provided tool-call "metadata" of any kind, including a claimed role/identity
  - Client-supplied fields on a run request other than the trusted server-derived identity
  - Tool/context/RAG content, including any embedded instruction-like text within it

TRUSTED ONLY AFTER VERIFICATION
  - The identity an AuthenticationAdapter resolves from the actual request (never from the
    request body)
  - The SecurityContext built from that identity (tenant, session, attributes)
  - A tool's own declared `security` metadata (requiredPermissions/risk/reversibility/
    approval), read from the registered tool definition, never from the model's tool-call
    arguments
  - Registered tools/components/policies themselves
```

`ActionRequest.metadata` (trusted) and `ActionRequest.arguments` (untrusted, model-provided)
are deliberately separate fields on the same type specifically so a model requesting
`{"role": "ADMIN"}` as a tool argument can never influence what the firewall treats as
authoritative — the firewall never reads `arguments` for authorization purposes, only for
policy `input` (which policies may still choose to constrain, e.g. schema-validated field
values, but never as an identity/role claim).

## PII / data policy

```text
Tool Result ──┐
              ├─→ DataPolicy.redact() ─→ Model-safe result ─→ SSE tool.completed event
Context     ──┘                                            ─→ Model's own tool-result message

Phase 4 context serialization ─→ DataPolicy.redactText() ─→ leading system message
```

A `DataPolicy` (`createFieldRedactionDataPolicy` or a custom implementation) is applied
symmetrically: the same redacted value is what both the client (`tool.completed`'s `result`)
and the model (the tool-result message appended to the conversation) ever see — there is no
path where the model receives less-redacted data than the UI, or vice versa.
`ContextEngineOptions.dataPolicy` accepts the same policy, typed structurally
(`{ redact(data: unknown): unknown }`) rather than imported from `@gixcopilot/security`, so
`@gixcopilot/context` never takes on a security-package dependency.

## Audit

Every firewall decision (allow/deny/approval) and every subsequent lifecycle event (approval
requested/decided, execution started/completed) is written to an `AuditSink` via
`ActionFirewall.record()`, scoped by tenant/actor/action/run/tool-call, carrying a decision
string and a coarse result status — never full tool arguments/results by default (Section 63's
"do not blindly persist full sensitive inputs/results"). `createSafeAuditSink` lets an
application choose `fail-open` (default: an audit write failure never blocks the action) or
`fail-closed` (a high-risk action aborts if it cannot be recorded) per sink.
