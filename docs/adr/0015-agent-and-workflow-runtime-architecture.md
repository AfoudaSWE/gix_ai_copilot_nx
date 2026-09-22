# ADR 0015: Agent & Multi-Agent & Workflow Runtime Architecture

## Status

Accepted (Phase 10). This ADR is updated as implementation proceeds through Phase 10's
milestones; see `docs/phases/phase-10/Phase_10_Decisions.md` for the full narrative record.

## Context

Phases 1–9 built a model runtime, a canonical tool architecture, an Action Firewall with
HITL approval, application context, RAG, and memory — but every run so far is a single
model reasoning in a single loop. Phase 10 needs agents (declarative, permission-scoped,
delegating/handing-off to one another), a deterministic workflow engine (steps, checkpoints,
retry, compensation), and durable long-running execution — without duplicating any of
Phases 1–9's authorization, tool, context, RAG, or memory machinery, and without taking a
hard dependency on a third-party agent framework (Article I).

## Decisions

### 1. Four new packages, no new `pnpm-workspace.yaml` glob

`@gixcopilot/agents`, `@gixcopilot/workflows`, `@gixcopilot/jobs`, and
`@gixcopilot/checkpoint-postgres` are flat top-level directories under `packages/`, already
covered by the existing `packages/*` glob. Dependency direction:
`protocol → core → tools → security → agents → workflows → {jobs, checkpoint-postgres}` —
no cycles. `@gixcopilot/workflows` defines `CheckpointStore` and `JobExecutor` as ports;
`jobs` (BullMQ/Redis) and `checkpoint-postgres` (Drizzle/Postgres) are leaf adapters that
implement them, mirroring `vectorstore-pgvector`'s existing relationship to `rag`'s
`VectorStore` contract. In-memory/inline default implementations of both ports live inside
`workflows` itself, so the core engine never requires Redis or Postgres to run.

`@gixcopilot/agents` deliberately does not depend on `rag`/`memory`/`context` — an agent's
knowledge/context is satisfied by already-resolved `ContextContribution`s assembled at the
composition layer, exactly how every other consumer of `@gixcopilot/context` already works.
It does depend on `@gixcopilot/security` (narrower than `core`/`tools`) because
least-privilege delegation must compute an *intersected*, never unioned, permission set
from a trusted `SecurityContext`/`Identity`, reusing `createPermissionAwareToolResolver()`.

### 2. Protocol extended additively: ancestry fields, new events, no new `RunStatus`

`Run` and `CopilotEventBase` both gain optional `rootRunId`/`parentRunId` for nested
agent/delegation/workflow-step tracing — absent for every Phase 1–9 run, so nothing existing
breaks. `RunStatus` stays a 5-value union; a paused *run* is still inferred from an
unresolved `approval.requested`, exactly as Phase 7 already does. `WorkflowRunStatus` (which
does need `paused`/`dead-lettered`) is `@gixcopilot/workflows`-internal persistence state,
not a protocol/wire type — a workflow run is not a protocol `Run`.

New `CopilotEvent` variants were added for facts that are genuinely new, not projections of
existing events: `agent.run.*`, `agent.delegation.*`, `agent.handoff`,
`agent.routing.decided`, `workflow.run.*`, `workflow.step.*` (carrying `attempt` for retry
and `phase: 'forward'|'compensation'` so retry/compensation reuse one event triad instead of
proliferating near-duplicate events), and `workflow.checkpoint.saved`. Approval steps
deliberately get **no** new event family: a workflow `ApprovalStep` bridges into a reserved
tool call through the existing `ToolRuntime`/`ActionFirewall`/`ApprovalStore` pipeline, so
`approval.requested/approved/rejected/expired` fire unchanged — following generative-ui's
`toGenerativeUiToolDefinition()`/`toStatePatchToolDefinition()` precedent of bridging into
an existing pipeline instead of building a parallel one. This is also how "no second
approval engine" and "no forged human approval" are enforced structurally, not just by
convention.

New `AGENT_*`/`WORKFLOW_*` `CopilotErrorCode`s were added following the exact
`CopilotError` static-factory pattern every prior phase used.

**Found and fixed while extending `serialization.ts`**: `publicCopilotErrorSchema`'s `code`
enum had never been updated for the Phase 8/9 error codes (`SOURCE_LOAD_FAILED` through
`MEMORY_READ_DENIED`) — a client parsing a legitimate Phase 8/9 error event would have gotten
`kind: 'invalid'` for a perfectly valid event. Fixed alongside adding the Phase 10 codes,
since the same list had to be touched anyway; disclosed here per Article IV rather than
silently folded in.

### 3. Delegation vs. handoff, and least privilege

Delegation (`A → B → A`) computes B's effective `SecurityContext` as the intersection of
A's trusted context and B's own declared, narrower tool/knowledge allowlist — never a union,
so an orchestrator's permissions are never the union of its specialists' permissions
(Section 55). Handoff (`A → B`, B becomes active) is validated only against the agent's
static, developer-declared `handoffTargets` graph — an arbitrary model-suggested target is
always rejected (`AGENT_HANDOFF_TARGET_INVALID`), regardless of what the model asked for.

### 4. Plans are data, never authorization

A `Plan`/`PlanStep` is a Zod-validated data structure a planner (via `generateObject()`, not
a new structured-output mechanism) produces; walking a plan only ever dispatches to the real
tool/agent runtimes, which still pass through the Action Firewall unchanged. A plan
requesting a destructive action is denied by the firewall exactly as if a human had typed
the same request — the plan itself grants nothing (Section 78, 191).

## Consequences

- No `protocol`/`core`/`client`/`server`/provider file needed a breaking change — every
  extension is additive; Phase 1–9's request/response/event shapes are untouched.
- Two pre-existing repository gaps were found and fixed as part of this work (see Testing/
  Issues docs): the `publicCopilotErrorSchema` enum gap above, and mechanical
  exhaustiveness-switch updates in `@gixcopilot/react`'s `chat-store.ts`/`provider.spec.tsx`
  and the `protocol-demo`/`model-streaming` examples, required because those files switch
  exhaustively over `CopilotEvent['type']`.
- Durable workflow persistence (`@gixcopilot/checkpoint-postgres`) and background execution
  (`@gixcopilot/jobs`) are real, Testcontainers-verified adapters in this phase, not stubs —
  see `docs/phases/phase-10/Phase_10_Testing.md` for the executed commands and results.
