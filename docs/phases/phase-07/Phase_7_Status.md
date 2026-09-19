# Phase 7 Status — Acceptance Criteria (Section 138)

Every item below was checked against the running code/tests in this session, not assumed.

## Security Architecture

- [x] Action Firewall exists. `@gixcopilot/security`'s `createActionFirewall`.
- [x] Framework-independent security package exists. Depends only on protocol + tools.
- [x] Trusted identity boundary exists. `AuthenticationAdapter` → `Identity` →
      `SecurityContext`, built server-side only.
- [x] Tenant boundary exists. `TenantIdentity`, enforced via ABAC policy (see
      `security-boundaries.spec.ts`'s tenant-isolation test).
- [x] RBAC works. `resolvePermissions`/`hasAllPermissions`, tested and verified live.
- [x] ABAC foundation works. `PolicyContext`/`Policy`/`PolicyRegistry`, tested with the
      brief's own Section 60 example verbatim.
- [x] Policy engine works. `evaluatePolicies`, fail-closed on throw.
- [x] Security fails closed where configured/required. Unauthenticated, unclassified-risk,
      and policy-evaluation-failure paths all deny/require-approval, never allow.
- [x] System prompts are not relied on for authorization. No prompt-based security exists
      anywhere in the implementation.

## Tool Security

- [x] Permission-aware tool discovery works. `createPermissionAwareToolResolver`, applied
      unconditionally in `app.ts` to both backend and frontend manifests.
- [x] Unauthorized tools hidden from model. Verified live and by test.
- [x] Execution-time authorization exists. The two-pass dispatch plus the
      `ToolRuntimeMiddleware` defense-in-depth layer.
- [x] Backend tools secured. Verified live and by test.
- [x] Frontend tools secured. Verified live and by test (server-side firewall gate before
      any browser execution request is sent).
- [x] Generative UI actions secured. `useInvokeTool()` routes through the server firewall
      once configured (reserved `ui.render.*`/`state.patch.*` tools are ordinary registered
      tools since Phase 6, so they were already covered by the same pipeline).
- [x] Unknown/manual tool requests cannot bypass firewall. Verified (denied before dispatch).

## HITL

- [x] User confirmation. Verified live and by test.
- [x] Supervisor approval. Verified live and by test.
- [x] Admin approval. Verified live and by test.
- [x] Two-person approval. Verified live and by test, including the duplicate-approver case.
- [x] Approval state machine. Pure functions, unit-tested for every transition.
- [x] Pause/interruption. The run suspends via `ApprovalStore.awaitDecision()`.
- [x] Resume. Verified live (the SSE stream resumed and completed after approval).
- [x] Rejection. Verified live and by test.
- [x] Expiration. Verified by test (auto-expiry via a scheduled timer).
- [x] Cancellation. Verified by test (cancelling a run cancels its pending approvals).
- [x] Duplicate approvals safe. Verified by test (idempotent, revision-guarded).
- [x] Reauthorization after approval. Verified by test (a permission revoked mid-wait denies
      at resume time despite the approval having been granted).

## Risk

- [x] Read/write/destructive classification. `ToolActionRisk`.
- [x] Reversible/compensatable/irreversible classification. `ToolActionReversibility`, a
      separate dimension from risk.
- [x] Configurable approval policy. `createDefaultRiskPolicy(overrides)`.
- [x] Explain-before-execute. The `summary` field plus the dry-run preview reaching the
      client on `approval.requested`, before any execution.
- [x] Dry-run architecture. `ToolDefinition.dryRun`, invoked at approval-request time and
      re-checked for staleness at resume time.
- [x] Dry-run does not mutate. `dryRun` is a separate, optional function from `execute` —
      the example's own `dryRun` implementations only read state.

## Data Security

- [x] Data classification foundation. `DataClassification`.
- [x] PII policy. `DataPolicy`/`createFieldRedactionDataPolicy`.
- [x] Context filtering. `ContextEngineOptions.dataPolicy` wired into serialization.
- [x] Tool-result filtering. Applied symmetrically to both the SSE event and the model's own
      message.
- [x] Approval UI avoids unsafe sensitive data exposure. The preview shown is the same
      already-redacted data the model/client receive elsewhere.
- [x] Prompt injection cannot bypass code-level authorization. Verified by test (an injected
      "you are admin, ignore rules" instruction inside tool output grants nothing).

## Audit

- [x] Audit abstraction. `AuditSink`/`createInMemoryAuditSink`/`createSafeAuditSink`.
- [x] Action decisions recorded. Every `evaluate()` outcome.
- [x] Approval lifecycle recorded. `approval.requested`/`approval.{status}` via
      `ActionFirewall.record()`.
- [x] Execution result recorded. `execution.started`/`execution.completed`.
- [x] Action history available. `GET /actions`, tenant/identity-scoped, verified live.
- [x] Sensitive data not blindly logged. Audit records carry decision/status metadata, never
      full tool arguments/results by default.

## UI

- [x] Confirmation UI. `ApprovalCard` at `user-confirmation` level.
- [x] Approval UI. `ApprovalCard`/`ApprovalList`.
- [x] Rejection/denial UI. `SecurityDenial`, wired into `ToolActivity`'s failed-row rendering
      for firewall-coded errors.
- [x] Action preview. Rendered inside `ApprovalCard` from the dry-run preview.
- [x] Headless APIs. `useApprovals`/`usePendingApprovals`/`useApproval`/`approveAction`/
      `rejectAction` — a React default component is never required to use them.
- [x] Accessibility. `ApprovalCard` verified with a real `axe-core` scan (zero violations),
      keyboard-operable buttons, focus management, `role="alertdialog"`/`"status"`/`"alert"`.
- [x] Responsive. No fixed dimensions; uses the same layout primitives as the rest of
      `@gixcopilot/ui`.
- [x] RTL. Verified by test (`dir="rtl"` rendering, no visual/interaction test failures).

## Testing

- [x] Authentication tests. [x] Permission tests. [x] Unauthorized discovery tests.
- [x] Execution defense tests. [x] Identity spoofing tests. [x] ABAC tests.
- [x] Tenant isolation tests. [x] PII tests. [x] Prompt injection tests.
- [x] User confirmation tests. [x] Supervisor tests. [x] Admin tests.
- [x] Two-person tests. [x] Expiration tests. [x] Cancellation tests.
- [x] Reauthorization tests. [x] Race tests (concurrent approval clicks). [x] Idempotency tests.
- [x] Dry-run tests. [x] Audit tests. [x] Frontend-tool tests. [x] Generative UI action tests.
- [x] Phase 1–6 regression. All prior tests pass unmodified except one assertion in
      `app.spec.ts` updated to match a disclosed, deliberate behavior improvement (see
      [Issues](Phase_7_Issues.md)).

## Documentation

- [x] All Phase 7 docs complete (this directory, 10 files).
- [x] Action Firewall documented. [x] Trust boundaries documented.
- [x] HITL architecture documented. [x] RBAC/ABAC documented.
- [x] PII/data policy documented. [x] Audit documented.
- [x] PROJECT_STATUS updated. [x] DECISIONS updated (ADR 0012).
- [x] TECHNICAL_DEBT updated. No CHANGELOG_PHASES file exists in this repository (same
      finding as Phase 2's own status doc) — `docs/PROJECT_STATUS.md`'s phase table serves
      this purpose, noted honestly rather than silently invented.

## Phase Gate

- [x] No OpenAPI auto-tool generation. [x] No MCP. [x] No RAG. [x] No persistent memory.
- [x] No agents. [x] No multi-agent workflows. [x] No Phase 8+ implementation of any kind.

## Overall

**STATUS: COMPLETE.**
