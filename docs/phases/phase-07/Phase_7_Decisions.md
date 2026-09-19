# Phase 7 Decisions

Full reasoning lives in [ADR 0012](../../adr/0012-action-firewall-and-hitl-architecture.md).
This page summarizes the decisions and the smaller ones that didn't rise to ADR-worthy.

## ADR 0012 summary

1. A new, framework-independent `@gixcopilot/security` package, depending only on protocol +
   tools — never on React, a provider SDK, or Fastify.
2. The firewall's canonical enforcement boundary is the tool-calling executor's own dispatch
   step (covers backend, frontend, and direct-invoked actions identically), not
   `ToolRuntimeMiddleware` alone (which cannot see frontend calls) — with the middleware kept
   as a second, defense-in-depth layer around the actual `ToolRuntime.execute()` boundary.
3. Firewall/approval evaluation for a batch happens in a first pass, entirely before the
   batch's one flush point, so a minutes-long approval wait can never leave the human's
   approval prompt unflushed in the server's memory.
4. `useInvokeTool()` becomes a real server round trip (a synthetic `ToolCall` pushed into the
   same dispatch path a model-requested call uses) once a firewall is configured, closing the
   "a generated button bypasses the model, therefore bypasses the firewall" gap.
5. Revalidation after a human decision reuses `ActionFirewall.evaluate()` itself
   (`revalidation: true`, to skip double rate-limiting) rather than a separate method — a
   second `'approval'` result is compared against the already-granted level, not treated as
   an automatic denial.
6. PII redaction is one `DataPolicy`, applied symmetrically to tool results (both the SSE
   event and the model's own tool-result message), Phase 4 context, and dry-run previews.

## Smaller decisions

- **Deny reuses the existing `tool.failed` event; no new `security.denied` event type was
  added.** The action-firewall skill's own "reuse existing run/tool events where appropriate"
  applies directly — a denial is, from the protocol's point of view, just a tool call that
  failed with a specific, stable error code (`PERMISSION_DENIED`, `TENANT_MISMATCH`, etc.).
- **`WAITING_FOR_APPROVAL` is a real `ChatStatus`/run-status value, not only inferred from the
  presence of an `approval.requested` event.** Both are true simultaneously in this
  implementation: the explicit status gives a simple single-string UI condition, while the
  underlying signal is still the ordinary `approval.*` event stream — a headless consumer
  needs neither to be told nor to infer anything beyond reading `useApprovals()`.
- **A tool's `security` field lives beside `metadata`, not nested inside it.** The brief's own
  `defineTool({ name, security: {...}, ... })` example (Section 131) treats it as its own
  top-level authoring concern; nesting it inside the pre-existing, unrelated `ToolMetadata`
  shape would have made a Phase 5 type do double duty as a Phase 7 one.
- **Approver authorization uses an `approvals.<level>` permission convention
  (`approvals.supervisor`, `approvals.admin`, `approvals.two-person`), with `admin` also
  satisfying any lower level.** `user-confirmation` is the one level intentionally not gated
  by a permission — the hitl skill's own architecture has the *requester* resolve it, by
  definition, so `canApprove()` allows any authenticated identity to answer their own
  `user-confirmation` request while a `POST /approvals/:id/approve` call is still separately
  checked against `requestedBy` to prevent one identity confirming a different identity's
  request (see [Testing](Phase_7_Testing.md)'s "binds user confirmation to the requester"
  case).
- **`GET /approvals`/`GET /actions` visibility is scoped, not "every authenticated user sees
  everything."** An identity sees an approval/action record if it holds any `approvals.*`
  permission or if the record concerns its own request — never merely because it is
  authenticated, which would leak cross-tenant/cross-user activity through an endpoint the
  brief itself only sketched at a conceptual level (Section 83).
- **A dry-run preview is regenerated and compared at resume time, not only produced once at
  request time.** Section 45's "do not blindly execute stale approved actions" is enforced
  directly: if the freshly-computed preview no longer matches what was approved, the action is
  denied (`POLICY_DENIED`) rather than executed against a resource that changed underneath the
  approval.
- **No dependency was added to any existing package's runtime dependencies.** `@gixcopilot/
  security` itself depends only on protocol + tools (both already in-workspace); `zod` is a
  devDependency only, for its own tests, at the same pinned version used everywhere else.
