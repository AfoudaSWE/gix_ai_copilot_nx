# Phase 10 architecture

## Package boundaries

```text
protocol
   ↑
 core
   ↑
 tools ──────┐
   ↑         │
security     │
   ↑         │
   └──── agents
             ↑
         workflows
          ↑     ↑
   checkpoint-postgres   jobs
```

- **`@gixcopilot/agents`** — framework-independent. Depends only on `protocol`, `core`
  (`EventSequencer`), `tools` (`ToolRuntime`/`ToolResolver`/manifest), `provider`
  (`ModelRuntime`/`generateObject`), `security` (`SecurityContext` type only — least-privilege
  intersection needs the shape, not a firewall instance), and `@opentelemetry/api`.
  Deliberately does **not** depend on `rag`, `memory`, or `context`: an agent's
  `AgentKnowledgeConfig`/`AgentMemoryConfig` are declarative scoping data the composition
  layer (a server route, an example) uses to build knowledge/memory-performing tools — the
  agent runtime itself never calls `@gixcopilot/rag`/`@gixcopilot/memory` directly. This
  keeps the dependency graph a strict DAG and matches how every tool call already reaches
  RAG/memory in this codebase (through a tool, not a bespoke second path).
- **`@gixcopilot/workflows`** — depends on `agents` (for the `agent` step type's
  `AgentRuntime`), `tools`, `security` (`ApprovalStore`/`ActionFirewall` types), `core`,
  `protocol`, `@opentelemetry/api`. Defines `CheckpointStore` and `JobExecutor` as ports with
  in-memory/inline default implementations — the engine never requires Redis or Postgres to
  run a workflow.
- **`@gixcopilot/checkpoint-postgres`** and **`@gixcopilot/jobs`** are leaf adapters
  implementing those two ports (Drizzle/Postgres; BullMQ/Redis respectively), mirroring
  `vectorstore-pgvector`'s existing relationship to `rag`'s `VectorStore` contract.

## Agent execution model

```text
User / composition layer
        │
        ▼
  AgentRuntime.run(options)
        │
        ▼
  ┌─────────────────────────────────────────────┐
  │ agent.run span (OTel)                        │
  │  while (true):                               │
  │    agent.model_call span → ModelRuntime.stream│
  │    tool_call.requested? → agent.tool_call span│
  │      → ToolRuntime.execute()  (Action Firewall)│
  │    agent.delegate.<id>? → agent.delegation span│
  │      → nested AgentRuntime.run() (recursive)  │
  │    agent.handoff.<id>? → agent.handoff span   │
  │      → nested run, result replaces this one   │
  │  until no more tool calls → agentRunCompleted │
  └─────────────────────────────────────────────┘
```

`createAgentRuntime()` returns one `run()` entry point; delegation and handoff both
recursively call the SAME internal `runAgent()` closure, never a second runtime instance —
this is what lets `AgentRunBudget` (tool-call/delegation counters) and depth tracking
accumulate across an entire delegation/handoff chain rather than resetting per hop (Section
42-44).

**Lifecycle** (Section 17, observable only through structured events, never raw
chain-of-thought — Section 18): `CREATED` (implicit, before the first event) → `RUNNING` →
per-turn `model_call` → optional `tool_call`/`delegation`/`handoff` → `COMPLETED` / `FAILED`
/ `CANCELLED`. Every transition emits an `agent.*` `CopilotEvent`
(`packages/agents/src/events.ts`), carrying `runId`/`rootRunId`/`parentRunId` ancestry so a
client or trace backend can reconstruct the full tree.

**Limits** (`packages/agents/src/limits.ts`): `maxIterations`/`maxToolCalls`/
`maxDelegations` (all budget-tracked, chain-wide) and `maxDepth` (cycle/runaway-delegation
protection) each have a conservative default (12/24/6/4) and a hard `timeoutMs` (120s
default) enforced via a combined `AbortController` that also propagates external
cancellation into the in-flight model call and any tool/child-run. A limit violation is a
distinct error family (`isAgentSafetyLimitError`) that propagates through every enclosing
delegation dispatch rather than being silently absorbed as an ordinary tool failure — a
runaway loop one level down still terminates the whole chain, not just that one hop.

## Least privilege: delegation vs. handoff

**Delegation** (`A → B → A`, Section 56-58): B's effective tool/knowledge/memory scope is
the **intersection**, never the union, of A's own currently-visible set and B's declared
allowlist (`intersectToolNames`/`intersectKnowledgeSources`/`intersectMemoryTypes` in
`delegation.ts`). This is enforced twice — once at model-tool-offer time (B's model never
even sees a tool outside the intersection) and again at dispatch time (defense in depth: a
tool name inside B's own declared allowlist but outside the intersection is still denied
before `ToolRuntime.execute()` is ever reached). One real consequence developers must know:
an **orchestrator that declares no tools of its own also silently gives every delegated
specialist zero tools**, regardless of what the specialist declares — because the
intersection ceiling is the *orchestrator's own effective tool set*, which is empty if it
never declared any. `examples/multi-agent`'s orchestrator therefore declares the union of
every specialist's tools even though it never calls them directly — documented explicitly in
that example and in [Issues](Phase_10_Issues.md).

**Handoff** (`A → B`, B becomes the active agent, Section 61-65): validated only against
`fromAgent.delegation.handoffTargets`, a static developer-declared allowlist — never an
arbitrary model-suggested target. B's result replaces A's own (`AgentRunResult.handoff`
marks which agent actually answered).

**Security context propagation** (Section 59, 185): both paths pass
`runOptions.securityContext` through unchanged — never reconstructed from model/tool
arguments. `delegation-security.spec.ts` proves a model attempting to smuggle a forged
identity through tool-call arguments is inert; the tool only ever receives the real,
runtime-supplied context via `ToolExecutionContext.metadata.securityContext`.

**Knowledge/memory narrowing** (Section 60, 131-132) is declarative-only defense in depth —
the actual RAG/memory access-control boundary remains Phase 9's own SecurityContext-derived
enforcement (`@gixcopilot/rag`'s permission-aware retriever, `@gixcopilot/memory`'s
ownership derivation), which is unaffected by what any agent declares. Narrowing here just
means a composition layer reading `context.metadata.knowledgeSources`/`memoryTypes` off a
delegated agent's tool-call context gets an already-narrowed list "for free."

## Parallel specialists

When a single model turn requests more than one delegation and none of that turn's calls is
a handoff, `runtime.ts` dispatches them **concurrently** via `Promise.allSettled` instead of
one at a time (Section 70-73, 189) — a natural consequence of the model choosing to emit N
`agent.delegate.*` tool calls in one turn, requiring no separate public API. Budget/depth
checks and `agent.delegation.started` events are emitted synchronously, per call, before any
dispatch's own `await`, so accounting stays deterministic even though the dispatches race;
results are re-assembled into `tool_result` messages in the model's own call order (not
completion order). `AgentDelegationConfig.parallelFailurePolicy` selects `'collect-results'`
(default: every delegation runs to completion regardless of siblings) or `'fail-fast'` (a
dedicated `AbortController` for the batch trips the moment one delegation fails, propagating
into every still-in-flight sibling's own `externalSignal`).

## Routing and planner/executor

`createDeterministicRouter()`/`createModelBasedRouter()` (`routing.ts`) both return an
`AgentRouteDecision` validated against a caller-supplied allowlist of candidate agent ids —
a model-selected agent id that isn't in `candidateAgentIds` is rejected
(`ROUTING_FAILED`), never trusted as-is (Section 50, 182: the prompt-injection-resistance
test in `routing.spec.ts`).

`createPlanner()` produces a `Plan` (Zod-validated `PlanStep[]`, `plan.ts`) via
`generateObject()` — the same structured-output mechanism Phase 5 already built, not a new
one. `validatePlanStructure()` rejects unknown tool/agent references and dependency cycles
**before** any step runs. `executePlan()` (`plan-executor.ts`) walks the plan sequentially,
dispatching each step through the real `ToolRuntime`/`AgentRuntime` — **a plan grants no
authorization by itself** (Section 78, 191): a planned deletion still goes through the
unmodified Action Firewall and is denied exactly as if a human had typed the same request.

## Workflow engine

```text
WorkflowEngine.start(options) → runLoop()
  workflow.run span
    for each runnable step (dependency-DAG order):
      workflow.step span
        function  → developer TypeScript, never model/plan-generated
        tool      → ToolRuntime.execute()        (Action Firewall)
        agent     → AgentRuntime.run()            (nests agent.run span)
        condition → developer-typed predicate, never a JS string
        parallel  → Promise.allSettled over sibling branch steps
        approval  → ApprovalStore.create() → checkpoint 'waiting_for_approval', PAUSE
  → checkpoint saved after every step (CheckpointStore)
  → 'completed' | 'failed' (with compensation) | pause-and-return
```

Steps run in **dependency order**, not necessarily declaration order (`nextRunnableStep()`
walks the DAG); `defineWorkflow()` validates the graph at registration time (unique step
ids, resolvable dependencies/branches, no cycles — Section 163, 192) and throws immediately
on a malformed definition rather than failing at run time.

**Checkpointing and resume** (Section 100-106, 198, 225-227): every step's outcome is saved
via `CheckpointStore` before the next step starts. `resume(workflowRunId)` is **idempotent**
(a terminal or still-genuinely-pending checkpoint is returned unchanged, never re-executed)
and validates the checkpoint's `workflowVersion` against the currently-registered
definition's `version`, refusing to resume a checkpoint against an incompatible workflow
shape (`WORKFLOW_RESUME_FAILED`) rather than corrupting execution.

**Approval steps** (Section 92, 125-126, 207) bridge into the exact Phase 7
`ApprovalStore`/`ActionFirewall` pipeline — no second approval engine. A workflow instance
is authoritative about *whether* an approval is required and *what it's for*; only a real
`ApprovalStore.approve()`/`.reject()` call (a human, or an authorized system per Phase 7
policy) ever unblocks it. No in-band data (a tool result, a model output, a forged
`"approved": true` field written into workflow state) is ever read as a decision — proven
directly by `reauthorization.spec.ts`'s approval-forgery test.

**Re-authorization on resume** (Section 128, 205, 227): `resume()` does **not** cache the
`SecurityContext` a workflow started with — the caller supplies a fresh one on each `resume`
call (falling back to a tenant-only, permission-less context if none is given, which fails
closed against any permission-gated step), and every subsequent tool/approval dispatch is
re-evaluated against it by the same Action Firewall that gates every other call. A caller
whose permission was revoked between pause and resume is denied at the consequential step,
not silently allowed through on stale authorization.

**Retry and compensation** (Section 117-121, 200-202): `RetryPolicy` classifies an error as
retryable/not (network/rate-limit vs. permission-denied/validation), backing off between
attempts; a non-retryable or exhausted failure triggers `runCompensation()`, which walks
already-completed steps' declared `compensate` tool calls in **reverse order**, best-effort
(one compensation failing does not stop the rest — Section 120's "compensation is not
rollback," a real reversing action, not a magic distributed-transaction undo).

**Jobs** (`@gixcopilot/jobs`): `createBullMQJobExecutor()` schedules each step's work as a
real BullMQ job with `jobId` derived deterministically from
`workflowRunId:stepId:attempt` (`workflowStepJobId()`), so a redelivered/duplicate schedule
of the SAME step attempt never runs the underlying closure twice. It is explicit about a
real limitation: a closure lives only in the process that scheduled it — if that process
dies mid-step, a redelivered job has nothing to call and completes as a no-op; the actual
crash-recovery path is the workflow's own next `resume()` call, driven by the checkpoint,
not by the job queue.

## Security diagram

```text
Agent / Workflow step
        │
        ▼
   Tool Request
        │
        ▼
  Tool Resolver (discovery, already permission-filtered)
        │
        ▼
   Action Firewall
   AuthN → RBAC/ABAC → Validation → Business Policy
   → PII Policy → Rate Policy → Approval → Audit
        │
        ▼
     Execute
```

Unchanged from Phase 7 — agents and workflows are new *callers* of this exact pipeline, not
a new enforcement path. Tenant isolation (`assertTenantMatch` in `engine.ts`) is checked
against the CALLER's trusted `SecurityContext.tenant`, never a tenant id an argument merely
claims, for every `resume`/`cancel`/`getCheckpoint` call.

## Observability

Both `agents` and `workflows` instrument with `@opentelemetry/api` directly (no SDK/exporter
dependency — a no-op tracer when nothing is configured, so this never touches the hot path).
Spans are linked via **explicit `Context` threading** through `AgentRunOptions`/step
dispatch rather than `startActiveSpan`'s implicit ambient propagation, chosen because both
runtimes are deeply recursive async functions where explicit parent-context passing is
easier to reason about and test than ambient context. `agent.run` nests
`agent.model_call`/`agent.tool_call`/`agent.delegation`/`agent.handoff`; a delegated child's
own `agent.run` span nests under its parent's `agent.delegation` span (Section 150's exact
hierarchy). `workflow.run` nests `workflow.step` per attempt (including a
`compensation`-phase attribute); a workflow's `agent` step nests the agent's own span tree
under that step's span. An approval wait spans a real process boundary (`start()` can return
while paused; the real wait happens outside memory entirely) — `workflow.approval_wait` is
therefore recorded **retroactively** at resume time using the persisted `ApprovalRequest`'s
own `createdAt`/decision timestamps as the span's actual start/end, not "now" (the
observability skill's "approval waits are spans with explicit start/end").

## React integration

`@gixcopilot/react`'s existing per-provider `ChatSnapshot` (built in Phase 3, extended every
phase since) gained four new fields — `agentRuns`/`agentDelegations`/`agentHandoffs`/
`workflowRuns` — populated by `chat-store.ts`'s already-existing event switch, which
previously no-op'd every `agent.*`/`workflow.*` case. `useAgentRun(id)`/`useAgentRuns()`/
`useAgentDelegations()`/`useAgentHandoffs()`/`useWorkflowRun(id)`/`useWorkflowRuns()` mirror
`useToolCalls()`/`useApprovals()`'s exact `useSyncExternalStore` pattern — no new store, no
new provider, no protocol change. A client with no agent/workflow-aware backend simply never
observes these event types; every hook returns an empty array/`undefined` exactly as before.
