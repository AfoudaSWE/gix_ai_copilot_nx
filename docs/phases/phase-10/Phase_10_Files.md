# Phase 10 files

Includes the pre-existing Phase 10 draft (the bulk of `packages/agents`, `packages/workflows`,
`packages/checkpoint-postgres`, `packages/jobs`, ADR 0015, and the protocol/react
exhaustiveness-switch groundwork) and this completion review's additions — real gap-closing
code, the missing test coverage, OpenTelemetry instrumentation, React hooks, three examples,
and all ten phase documents. Generated `dist`, `node_modules`, `.tsbuildinfo` are excluded.

## Added — pre-existing draft (this review's starting point)

- `docs/adr/0015-agent-and-workflow-runtime-architecture.md`
- `packages/agents/{package.json,project.json,tsconfig.json,vitest.config.ts}`
- `packages/agents/src/{definition,execution-context,registry,limits,delegation,handoff,
  messages,events,routing,plan,planner,plan-executor,runtime,test-harness}.ts` and their
  original `.spec.ts` files (`definition` had none; `delegation`, `handoff`, `registry`,
  `routing`, `plan`, `planner`, `plan-executor`, `runtime`, `delegation-security` did)
- `packages/agents/src/index.ts`
- `packages/workflows/{package.json,project.json,tsconfig.json,vitest.config.ts}`
- `packages/workflows/src/{definition,steps,state,checkpoint,jobs,retry,compensation,events,
  engine,test-harness}.ts` and their original specs (`definition`, `engine`,
  `approval-step`, `durability`)
- `packages/workflows/src/index.ts`
- `packages/checkpoint-postgres/` — complete (schema, Drizzle migrations, store, integration
  spec, config)
- `packages/jobs/{package.json,project.json,tsconfig.json,vitest.config.ts}`,
  `packages/jobs/src/{bullmq-job-executor,dead-letter,index}.ts` (implementation only — zero
  tests existed)
- Protocol/react exhaustiveness-switch groundwork already reflected in the `Modified` list
  below

## Added — this review

- `packages/agents/src/tracing.ts`, `packages/agents/src/tracing.spec.ts` — OpenTelemetry
  instrumentation + real span-nesting verification.
- `packages/agents/src/messages.spec.ts` — the message bus had no test coverage at all.
- `packages/agents/src/parallel-delegation.spec.ts` — new feature (same-turn concurrent
  delegation) + its own tests.
- `packages/workflows/src/tracing.ts`, `packages/workflows/src/tracing.spec.ts` — same OTel
  pattern, plus the retroactively-timed approval-wait span.
- `packages/workflows/src/reauthorization.spec.ts` — re-authorization-on-resume, approval-
  forgery-resistance, and a prompt-injection-resistance test, none of which existed.
- `packages/jobs/src/bullmq-job-executor.spec.ts`, `packages/jobs/src/dead-letter.spec.ts` —
  real `@testcontainers/redis` integration tests (9 tests; the package had zero before).
- `packages/react/src/agent-workflow-progress.spec.tsx` — tests for the six new hooks.
- `examples/agent-basic/` — complete (package.json, project.json, tsconfig, vitest.config,
  README, `src/{agent,knowledge,tools,main,integration.spec}.ts`).
- `examples/multi-agent/` — complete (same file set, `src/{agents,tools,main,
  integration.spec}.ts`).
- `examples/workflow-approval/` — complete (same file set, `src/{agent,tools,workflow,main,
  integration.spec}.ts`).
- `docs/phases/phase-10/Phase_10_{Docs,Architecture,Implementation,Status,Testing,Decisions,
  API,Files,Issues,Handoff}.md` — all ten required documents (none existed before this
  review, despite ADR 0015 already citing two of them by name).

## Modified — this review

- `packages/agents/src/runtime.ts` — `AgentExecutionContext` actually constructed and used
  (was dead code); knowledge/memory intersection narrowing threaded through delegation/
  handoff/parallel dispatch; same-turn parallel delegation fan-out; OTel span instrumentation
  at every dispatch point (model call, tool call, delegation, handoff, run).
- `packages/agents/src/definition.ts` — `AgentDelegationConfig.parallelFailurePolicy`.
- `packages/agents/src/delegation.ts` — `intersectKnowledgeSources`/`intersectMemoryTypes`.
- `packages/agents/src/delegation-security.spec.ts` — added the knowledge/memory-narrowing
  security test.
- `packages/agents/src/runtime.spec.ts` — added cancellation (mid-model-call, mid-tool-call)
  and timeout tests (Section 203/204/179-181 gap).
- `packages/agents/src/index.ts` — nothing removed; no new public export was needed for the
  parallel-delegation feature (it's automatic, not a new API surface).
- `packages/agents/package.json` — `@opentelemetry/api` (dependency),
  `@opentelemetry/sdk-trace-base` (devDependency).
- `packages/workflows/src/engine.ts` — OTel span instrumentation (`workflow.run`/
  `workflow.step`/parallel-branch spans, retroactive `workflow.approval_wait`).
- `packages/workflows/package.json` — same two OpenTelemetry dependencies.
- `packages/react/src/types.ts` — `AgentRunState`/`AgentDelegationState`/
  `AgentHandoffState`/`WorkflowRunState`/`WorkflowStepState`, four new `ChatSnapshotBase`
  fields.
- `packages/react/src/chat-store.ts` — the previously-no-op `agent.*`/`workflow.*` switch
  cases now build real state; `stop()` and `run.cancelled` both mark any still-running
  agent/workflow runs cancelled.
- `packages/react/src/provider.tsx` — six new hooks.
- `packages/react/src/index.ts` — six new hook exports, five new type exports.
- `pnpm-workspace.yaml` — fixed a placeholder value (`msgpackr-extract: set this to true or
  false`) that hard-failed `pnpm install` for the entire repository (see
  [Issues](Phase_10_Issues.md)).
- `docs/DECISIONS.md` — Phase 10 ADR 0015 index row (already present from the prior
  session's draft; unmodified further by this review beyond the completion-review sentence
  added alongside the Status update).
- `tsconfig.json` — project references for `examples/agent-basic`, `examples/multi-agent`,
  `examples/workflow-approval`.
- `docs/PROJECT_STATUS.md` — Phase 10 status flip and validation section (see
  [Status](Phase_10_Status.md)).
- `pnpm-lock.yaml` — new dependencies above.

## Files this review read but did not need to change

`packages/protocol/src/{errors,events,index,run,serialization}.ts`,
`examples/model-streaming/src/main.ts`, `examples/protocol-demo/src/main.ts`, `eslint.config
.js`, `tools/vitest.shared.ts`, `packages/react/src/provider.spec.tsx` — all already correct
from the prior session's draft (protocol event/error additions, exhaustiveness-switch
updates, workspace tooling for the four new packages).
