# Phase 7 Issues

## Bugs found and fixed during implementation

1. **Discovery-time filtering made a hidden tool's security metadata invisible to
   execution-time enforcement.** The firewall's pass-1 metadata lookup originally read a
   call's `security` manifest from the *permission-filtered* backend tool list — the same
   list used to build the model's manifest. For a tool a caller's identity cannot see
   (Section 20's discovery filtering), that same lookup found nothing, so
   `actionMetadataOf()` produced an empty `requiredPermissions`/undefined `risk`, and the
   firewall's RBAC check passed vacuously (an empty requirement list is always satisfied).
   A manually-constructed call for a hidden tool was silently escalated into an *approval*
   requirement (an unclassified risk defaults to the strictest configured level) instead of
   an immediate deny — and since nothing in the test ever resolved that approval, the run
   hung indefinitely. Fixed by adding a separate, *unfiltered* `securityToolResolver` used
   only for metadata lookup (Section 21's defense in depth: discovery filtering and
   execution-time authorization are different concerns and must not share one filtered
   view). Caught by `security-integration.spec.ts`'s "execution defense" and "identity
   spoofing" tests, which hung under the old code and pass in well under a second now.
2. **A frontend `tool.requested` event was announced before authorization/approval
   succeeded.** The two-pass dispatch's pass 1 originally announced every call's
   `tool.requested` event, including frontend-sourced ones, before evaluating the firewall.
   Since a client executes a frontend tool immediately upon receiving `tool.requested` with
   `source: 'frontend'`, a call that should have been denied or paused for approval would
   already be running in the browser by the time the firewall's decision was known. Fixed by
   deferring a frontend call's `tool.requested` announcement to pass 2, strictly after
   authorization/approval succeeds — a native/reserved call's announcement still happens in
   pass 1 (it does not trigger any client-side execution on its own).
3. **Revalidation treated its own stateless re-derivation as a fresh denial.** Because
   `ActionFirewall.evaluate()` has no notion of "this exact request was already approved,"
   calling it again after a human decision always re-derives the same approval requirement
   from the tool's risk classification — never `'allow'` on its own. An early implementation
   read a second `'approval'` result as "the action still needs approval, therefore deny" and
   would have blocked every single approved action from ever executing. Fixed by comparing
   the freshly-computed required level against the level a human actually granted
   (`strongerApprovalLevel`) — only a *stronger* requirement than what was granted (e.g. a
   policy escalated mid-flight) is treated as a fresh denial; an equal-or-weaker
   re-derivation is accepted as still-authorized.
4. **A submitted frontend tool result was accepted without checking it matched the
   requested call.** `FrontendToolBridge.submitResult(runId, toolCallId, result)` keyed its
   pending-call lookup by the URL's `toolCallId`, but never checked that the result body's
   own embedded `toolCallId` field matched it — a malformed or spoofed submission could
   resolve the wrong pending call with a result meant for a different one. Fixed with an
   equality check before resolving.
5. **`ToolRuntime.execute()` could still start work after its run had already been
   cancelled.** Two additional `context.signal.aborted` checks were added (before resolving
   the tool, and immediately before invoking `execute()`) so a call that arrives already
   cancelled fails fast with `CANCELLED` instead of doing wasted (and, under concurrent
   approval-cancellation, potentially racy) work.

## Known limitations

- **Approval/audit/rate-limit state is in-memory and process-local**, the same documented
  limitation as the pre-existing run registry and frontend-tool bridge (see
  `docs/TECHNICAL_DEBT.md`). A multi-instance deployment needs a shared `ApprovalStore`/
  `AuditSink`/`RateLimiter` — out of scope for this phase.
- **`redactText`'s context/text redaction is a regex-based JSON-shaped-text matcher**, not a
  full parser — it matches complete, well-formed `"key": "value"` pairs inside serialized
  text and is deliberately conservative (an unmatched shape is left alone rather than
  guessed at). A context item serialized in a materially different shape than Phase 4's own
  JSON-block convention would not be redacted by this mechanism; a custom `DataPolicy` can
  always replace it.
- **The `approvals.<level>` permission-naming convention is documented, not type-enforced.**
  An application is free to use a different scheme by supplying its own `RolePermissionMap`
  and is not required to name permissions this way — `canApprove()`'s specific string
  convention is this package's own default expectation, not a hard requirement elsewhere in
  the firewall.
- **Two-person approval requires exactly two distinct approvers for every level so
  configured; there is no support for "N of M" beyond two.** Extending
  `requiredApproversFor`/the approval-decision accumulation to an arbitrary N was judged
  out of scope — the brief's own required levels stop at two-person.
- **`GET /actions` (action history) and `GET /approvals` visibility scoping is a first
  implementation of Section 67/83's sketch, not a full-featured audit query API** — no
  pagination, filtering by date range, or export exists yet. Sufficient for the example and
  for the mandated tests; a production deployment with a large audit volume would want a
  real query interface backed by a database, which is explicitly out of scope (Section 9's
  "must NOT depend on PostgreSQL implementation").

## Explicitly out of scope (Phase 8+, not attempted)

OpenAPI → tool generation, MCP integration, RAG, vector databases, persistent AI memory,
agents, multi-agent systems, long-running agent workflows, a visual agent builder, a DevTools
platform, an evaluation platform, the Angular SDK, and an enterprise management platform. The
Action Firewall's own architecture was reviewed against each of these future integration
points (Sections 73-75, 117-120) without implementing any of them — see
[Architecture](Phase_7_Architecture.md)'s trust-boundary section, which any future OpenAPI/
MCP/agent-derived tool call will pass through unchanged.
