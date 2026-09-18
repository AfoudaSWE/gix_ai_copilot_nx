---
name: hitl
description: Human-in-the-loop architecture - approval levels, pause/resume/interrupt, approve/reject, expiration, and approval audit. Load when implementing anything that pauses agent execution for a human decision.
---

# Purpose

Define how agent/tool execution pauses for human approval, and how that approval state is
represented, authorized, and audited.

# When to Apply

Implementing or modifying any pause/approve/reject flow for tool calls or agent runs, or
wiring approval policy into the [[action-firewall]] pipeline.

# Required Rules

- Approval level is one of a fixed, explicit set: `NONE`, `USER_CONFIRMATION`,
  `SUPERVISOR_APPROVAL`, `ADMIN_APPROVAL`, `TWO_PERSON_APPROVAL`. A tool/action's required
  level is declared as permission metadata (see [[tool-system]]) and enforced by
  [[action-firewall]].
- A paused run is a first-class, persisted state (see [[protocol-design]]'s `Approval`
  entity) — not an in-memory-only suspension that is lost on process restart.
- Pause/resume/interrupt are explicit protocol operations: pausing a run for approval emits
  an event; resuming after approval/rejection emits an event; a run can also be interrupted
  (cancelled) while pending approval.
- Approve/reject actions are themselves authorized: the approver's identity and permission
  level are checked against the required approval level before the decision is accepted —
  a `SUPERVISOR_APPROVAL` action must not be resolvable by an unprivileged user.
- `TWO_PERSON_APPROVAL` requires two distinct, independently-authorized approvers; the same
  identity approving twice does not satisfy the requirement.
- Pending approvals expire after a configurable timeout; an expired approval resolves to a
  defined terminal state (e.g. auto-rejected) rather than remaining pending indefinitely.
- Every approval decision (who, when, what was approved/rejected, and why if provided) is
  recorded in the audit trail produced by [[action-firewall]].
- Rejecting an approval must leave the system in a safe, well-defined state — the
  underlying action must not have executed, and any partial side effects from
  building the request must be rolled back or were never applied.

# Architecture / Patterns

```text
Tool/Action requires approval level L
        ↓
Run pauses → Approval entity created (state: PENDING, level: L, expiresAt)
        ↓
Approver(s) with sufficient authorization → approve | reject
        ↓
Run resumes (approved) | Run fails safely (rejected/expired)
```

# Anti-Patterns

- Holding pending-approval state only in memory, losing it on a server restart.
- Allowing any authenticated user to resolve a `SUPERVISOR_APPROVAL` or `ADMIN_APPROVAL`.
- A `TWO_PERSON_APPROVAL` that accepts the same user's approval twice.
- An approval with no expiration that can remain pending forever, silently blocking a run.
- Executing part of the action before approval is granted "to save time."

# Validation Checklist

- [ ] Approval level is declared per tool/action and enforced by [[action-firewall]]
- [ ] Pending approval state is persisted, not memory-only
- [ ] Approver authorization is checked against the required level before accepting a decision
- [ ] Two-person approval requires two distinct approvers
- [ ] Approvals expire and resolve to a defined terminal state
- [ ] Every decision is recorded in the audit trail
