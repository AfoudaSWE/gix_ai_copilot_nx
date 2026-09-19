# Phase 7 Testing

All commands below were actually executed this session; figures are copied from real output,
not estimated.

## Full workspace validation

```sh
pnpm nx run-many -t lint       # 22/22 projects pass
pnpm nx run-many -t typecheck  # 22/22 projects pass
pnpm nx run-many -t test       # 21/21 testable projects pass
pnpm nx run-many -t build      # 21/21 buildable projects pass
```

**351 Vitest tests passed, 1 pre-existing optional OpenAI smoke test skipped** (in
`examples/model-streaming`, no key present for that example), zero failures — including every
Phase 1–6 test, with one pre-existing Phase 5 assertion in `packages/server/src/app.spec.ts`
updated to match a deliberate, documented behavior improvement (see
[Issues](Phase_7_Issues.md) item 5 and the inline comment left in that test).

Disclosure: `examples/react-generative-ui`'s own optional real-OpenAI smoke test (added in an
earlier, non-phase task, unrelated to Phase 7) executed live against the real OpenAI API
during this run and passed, because a `.env` file with a real key happened to already be
present in that example's directory from that earlier task. This is incidental, not a Phase 7
requirement, and is not evidence about `examples/react-enterprise`'s own optional chat path —
see below.

## `@gixcopilot/security` — 86 tests, 11 files

Unit coverage for every module: permission resolution and `canApprove` (13), the policy
engine including the exact Section 60 business-policy example and fail-closed-on-throw (7),
the default risk policy and level ordering (8), the approval state machine including
two-person distinctness and duplicate-approve no-ops (15), the in-memory approval store
including `awaitDecision`, expiration timers, and cancellation-while-waiting (9), PII
redaction including nested/array data and full-secret masking (9), audit sink fail-open/
fail-closed behavior (4), rate limiting (4), permission-aware tool discovery (3), the firewall
orchestrator itself — authentication, RBAC, rate limiting, business-policy denial, the full
risk → approval-level matrix, and per-decision audit records (10) — and a dedicated hardening
suite (4) covering idempotent approval creation, atomic revision-guarded decisions, an
already-aborted `awaitDecision` rejecting immediately, and the firewall's revalidation not
double-charging the rate limiter.

## `@gixcopilot/server` — 49 tests, 8 files (41 pre-existing + Phase 7's own 22)

`security-integration.spec.ts` (11 tests, real HTTP against a real in-process server, a real
`ActionFirewall`, and a real `ApprovalStore` — no mocked security layer anywhere):

- Unauthorized tool discovery: a VIEWER identity's model manifest never includes
  `applications.delete`/`reassign` (Section 96).
- Execution defense: a manually-constructed `applications.delete` call is denied and never
  executes for an unauthorized identity, and *does* execute after admin approval for one that
  holds the permission (Section 97).
- Identity spoofing / prompt injection: a model-supplied `role: "ADMIN"` argument and
  injected instruction text in the same call grant no authority (Section 98-99).
- User confirmation: a write action pauses, then executes exactly once after self-confirm
  (Section 100).
- Supervisor approval + rejection: the requester cannot approve their own supervisor-level
  request (403); a real rejection leaves the action never executed (Section 101, 27).
- Expiration: an unresolved approval auto-expires; the action never executes (Section 102).
- Cancellation while pending: cancelling the run cancels the approval; a late approve attempt
  cannot execute it (Section 103).
- Reauthorization: a permission revoked *during* the approval wait (simulated via an
  adapter that returns a different identity on the revalidation call) denies execution at
  resume time even though the approval itself was granted (Section 104).
- Two-person: the same approver approving twice does not count; two distinct approvers
  execute the action exactly once (Section 105).
- Frontend tool discovery: an unauthorized client-declared frontend tool never reaches the
  model's manifest (Section 71, 110).
- PII redaction: the model's own tool-result message (not only the SSE event) contains only
  the redacted value, never the raw one (Section 56, 107, 137).

`security-boundaries.spec.ts` (7 tests, real HTTP):

- Approval/action visibility and decision authority are scoped to tenant and identity — an
  outsider sees no approvals/actions and cannot approve, reject, or cancel another tenant's
  run (403).
- `user-confirmation` binds to the specific requester, even for an administrator (403 for
  anyone else).
- A forged frontend manifest claiming `approval: 'none'` for a tool is ignored — the server's
  own registered frontend tool definition is authoritative, and the browser only receives the
  execution request after real approval.
- A stale resource after approval (mutated between request and approval) denies with
  `POLICY_DENIED` and never executes (Section 45).
- Concurrent/duplicate two-person approval clicks serialize into exactly one execution.
- Context and nested/array tool results are redacted before reaching the model; a
  prompt-injection attempt embedded in tool output cannot grant authority; a tenant-scoped
  ABAC policy is enforced on the same request.
- An unknown direct action and malformed tool input are denied before any approval is ever
  created.

## `@gixcopilot/react` / `@gixcopilot/ui` — 63 tests across both packages

`approval-hooks.spec.tsx` (2): `useApprovals`/`usePendingApprovals` track the full
`approval.requested → approval.approved` lifecycle; `approveAction`/`rejectAction` delegate to
the client. `generative-ui-hooks.spec.tsx` gained one case: a generated button's action routes
through the server and never calls the local `execute()` on denial (Section 111). `ui/
approval.spec.tsx` (3, including a real `axe-core` accessibility scan with zero violations)
covers risk announcement, focus management, RTL rendering, a failed network decision leaving
the card interactive and never leaking the raw error detail, and a cancelled approval
rendering safely alongside `SecurityDenial` with no interactive controls.

## Manual, real end-to-end verification (this session, not simulated)

`examples/react-enterprise`'s built server was started for real (`node dist/server.js`, no
API key configured) and exercised over real HTTP with `curl`:

- Viewer → `applications.delete` → `PERMISSION_DENIED`, confirmed via the SSE stream.
- Officer → read own-tenant record → success, with `passportNumber`/`email` redacted in the
  live response (`"A******78"`, `"[email hidden]"`).
- Officer → read a different tenant's record → `TENANT_MISMATCH`.
- Officer → request a supervisor-level reassignment → `approval.requested` with a real
  dry-run preview (`before`/`after` values) delivered over the still-open SSE stream.
- The requester's own token attempting `POST /approvals/:id/approve` → `403`.
- A supervisor's token approving the same request → `200`, and the original SSE stream
  resumed and completed with the actual mutation applied (`"assignee":"Officer B"`).
- `GET /actions` as a supervisor → a real, populated audit trail reflecting every decision
  above (deny, allow, execution.started/completed).

## What was not tested against real OpenAI

No `OPENAI_API_KEY` was configured for `examples/react-enterprise` in this session, so its own
optional chat panel was never exercised against a live model. This is disclosed rather than
assumed — see [Status](Phase_7_Status.md)'s completion report for the explicit NOT TESTED
marking. Every capability the firewall/HITL pipeline itself is responsible for was verified
without a model at all, via the example's direct-action path, which uses the identical
enforcement code a real model's tool calls would go through (see
[Architecture](Phase_7_Architecture.md)).

## Not re-run this session

The Chromium/Playwright browser suite (`react-e2e`) has no Phase 7-specific coverage and was
not re-run; its lint/typecheck targets were re-run and pass, matching the disclosure pattern
used in every prior phase's status doc.
