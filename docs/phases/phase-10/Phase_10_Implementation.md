# Phase 10 implementation notes

## `@gixcopilot/agents`

| File | Responsibility |
| --- | --- |
| `definition.ts` | `AgentDefinition`/`defineAgent()` — declarative instructions/model/tools/knowledge/memory/delegation/limits/metadata. |
| `execution-context.ts` | `AgentExecutionContext` — the trusted identity/signal shape a run threads through dispatch; constructed once per run in `runtime.ts` and attached to every tool call's `context.metadata`. |
| `registry.ts` | `createAgentRegistry()`, `validateAgentGraph()` — no mandatory global singleton, disposable handles. |
| `limits.ts` | `AgentLimits` defaults/assertions (iteration/tool/delegation/depth/timeout). |
| `delegation.ts` | Reserved `agent.delegate.<id>` tool shape, `intersectToolNames`/`intersectKnowledgeSources`/`intersectMemoryTypes`. |
| `handoff.ts` | Reserved `agent.handoff.<id>` tool shape, static allowlist validation. |
| `messages.ts` | `createAgentMessageBus()` — minimal in-process pub/sub for parallel-specialist notification; delegation/handoff never use it (they're already structured/auditable). |
| `events.ts` | `agent.*` `CopilotEvent` factories, `AgentEventCorrelation`. |
| `routing.ts` | `createDeterministicRouter()`/`createModelBasedRouter()`. |
| `plan.ts` / `planner.ts` / `plan-executor.ts` | `Plan` schema/validation, `generateObject()`-backed planner, sequential dispatcher. |
| `runtime.ts` | `createAgentRuntime()` — the think/act/observe loop, delegation/handoff/parallel dispatch, limits, cancellation, OTel spans. |
| `tracing.ts` | `@opentelemetry/api` span helpers (explicit `Context` threading, not `startActiveSpan`). |
| `test-harness.ts` | `createAgentTestHarness()` — zero-network/zero-DB test rig used by every spec in this package and by the examples' own tests. |

## `@gixcopilot/workflows`

| File | Responsibility |
| --- | --- |
| `definition.ts` | `WorkflowDefinition`/`defineWorkflow()`, `validateWorkflowGraph()` (unique ids, resolvable deps/branches, cycle detection). |
| `steps.ts` | Ergonomic step constructors (`functionStep`/`toolStep`/`agentStep`/`approvalStep`/`conditionStep`/`parallelStep`) — thin identity functions, no behavior. |
| `state.ts` | `WorkflowCheckpoint<TState>`/`WorkflowStepRecord` shapes. |
| `checkpoint.ts` | `CheckpointStore` port + `createInMemoryCheckpointStore()` default. |
| `jobs.ts` | `JobExecutor` port + `createInlineJobExecutor()` default, `workflowStepJobId()`. |
| `retry.ts` | `RetryPolicy`, backoff, retryable-error classification. |
| `compensation.ts` | `buildCompensationPlan()` — reverse-order, best-effort. |
| `events.ts` | `workflow.*` `CopilotEvent` factories. |
| `tracing.ts` | Same OTel pattern as `agents`, plus `recordHistoricalSpan()` for the cross-process approval wait. |
| `engine.ts` | `createWorkflowEngine()` — the DAG walk, step dispatch (including the `agent`-step → `AgentRuntime.run()` bridge), checkpointing, `start`/`resume`/`cancel`/`getCheckpoint`, tenant isolation. |
| `test-harness.ts` | `createWorkflowTestHarness()` — same zero-infra posture, exported publicly and reused by all three examples' own tests. |

## `@gixcopilot/checkpoint-postgres`

Drizzle schema (`schema.ts`) + `createPgCheckpointStore()` (`pg-checkpoint-store.ts`) —
optimistic-concurrency writes keyed on `version` (a stale write is rejected, not silently
overwritten), tenant/workflow-id filtering on every query. `pg-checkpoint-store.integration
.spec.ts` is a genuine `@testcontainers/postgresql` run (`describe.skipIf(!dockerAvailable)`),
following `vectorstore-pgvector`'s exact template.

## `@gixcopilot/jobs`

`bullmq-job-executor.ts` — real `Queue`/`Worker`/`QueueEvents` against a real Redis
connection; `defaultAttempts: 1` by default (workflows' own `RetryPolicy` is authoritative,
so BullMQ-level retry is deliberately not layered on top by default). `dead-letter.ts` —
`createDeadLetterInspector()` reads BullMQ's own `failed` job set (`removeOnFail: false`),
no second dead-letter store. Both got a genuine `@testcontainers/redis`-backed integration
suite this session (`bullmq-job-executor.spec.ts`, `dead-letter.spec.ts` — 9 tests total),
closing a gap where the package had zero test coverage despite already declaring
`bullmq`/`@testcontainers/redis` as dependencies.

## New dependencies

| Package | Where | Why |
| --- | --- | --- |
| `@opentelemetry/api` | `agents`, `workflows` (runtime dep) | Section 149's OTel requirement; API-only, no SDK/exporter, so a host with nothing configured pays a near-zero no-op cost. Per dependency-policy, added directly to the two packages that need it rather than a new wrapper package (repo guidance explicitly warns against unnecessary package fragmentation). |
| `@opentelemetry/sdk-trace-base` | `agents`, `workflows` (dev dep) | `InMemorySpanExporter`/`BasicTracerProvider` for real span-nesting assertions in tests, not a mocked tracer. |
| `bullmq` | `jobs` (already present) | Real Redis-backed job queue — pre-existing dependency, now actually exercised by tests. |
| `@testcontainers/redis` | `jobs` (dev, already present) | Real-Redis integration testing, mirroring `@testcontainers/postgresql`'s existing use in `checkpoint-postgres`/`vectorstore-pgvector`. |

## Notable tradeoffs

- **OTel context threading is explicit, not ambient.** `startActiveSpan`'s implicit
  `context.with()` propagation would have required restructuring `runtime.ts`'s/`engine.ts`'s
  already-deep, heavily-tested control flow into nested callbacks — high risk for a 400+ line
  function with 55 existing passing tests. Explicit `Context` values threaded through
  `AgentRunOptions.otelParentContext`/step-dispatch parameters achieve identical parent-child
  span nesting (verified directly in `tracing.spec.ts` for both packages) with surgical,
  low-risk edits.
- **The orchestrator tool-ceiling behavior is a real, sometimes-surprising consequence of
  strict "intersection never union" delegation** (see Architecture's "Least privilege"
  section) — a stricter reading than the spec's own Section 55 prose ("each delegated
  execution authorized independently"), but consistent with the ALREADY-WRITTEN, ALREADY-
  TESTED prior-session implementation and its own `delegation-security.spec.ts`. This session
  extended that existing choice (knowledge/memory narrowing, parallel dispatch) rather than
  relitigating it — see [Issues](Phase_10_Issues.md) for the explicit tradeoff writeup.
- **In-memory checkpoint/approval stores remain the example/test default**; only
  `checkpoint-postgres`'s own integration suite and a real deployment use Postgres. Matches
  Phase 9's "not a production recommendation" framing for its own in-memory vector store.
- **React's new state lives on the existing per-run `ChatSnapshot`**, not a new store/context
  — an agent/workflow run is inherently scoped to the SAME client run's event stream every
  other `ChatSnapshot` field already reflects; a separate store would have needed its own,
  redundant subscription to the same events with no additional capability.
