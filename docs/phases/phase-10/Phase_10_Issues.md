# Phase 10 issues and limits

## Resolved during this review

| Finding | Resolution / evidence |
| --- | --- |
| `pnpm-workspace.yaml`'s `allowBuilds` map had a literal placeholder string (`msgpackr-extract: set this to true or false`) instead of a boolean, so `pnpm install` hard-failed with `ERR_PNPM_IGNORED_BUILDS` and blocked every `nx` command in the whole repository before any Phase 10 work could even be validated | Set `msgpackr-extract: true` (a well-known native binding pulled in transitively by `bullmq`/`ioredis` for the new `jobs` package); `pnpm install` now succeeds |
| Delegation/handoff only narrowed **tools** (`intersectToolNames`); `AgentKnowledgeConfig.sources`/`AgentMemoryConfig.types` were declared but never intersected, contradicting the spec's "child cannot exceed parent's knowledge/memory access" framing (Section 60, 131-132) | Added `intersectKnowledgeSources`/`intersectMemoryTypes`, threaded through delegation/handoff/parallel dispatch the same way tool names already were; new test in `delegation-security.spec.ts` proves a delegated agent's own broader declared scope is narrowed |
| No parallel specialist execution existed at the agent-orchestration layer (`plan-executor.ts` is explicitly sequential-only; `packages/agents/src/steps/` was an empty, unreferenced directory — an apparent abandoned stub) | Implemented same-turn concurrent delegation dispatch (`runtime.ts`) with a real `'fail-fast'`/`'collect-results'` policy and genuine sibling-abort propagation; removed the empty directory; 4 new tests in `parallel-delegation.spec.ts` (run-id correlation, both failure policies, parent-cancellation propagation) |
| `packages/jobs` (the BullMQ/Redis `JobExecutor` adapter and dead-letter inspector) had **zero test files** despite already declaring `bullmq`/`@testcontainers/redis` as dependencies | Added `bullmq-job-executor.spec.ts`/`dead-letter.spec.ts` — 9 tests against a real Redis via Testcontainers (idempotent scheduling, error propagation, concurrency, dead-letter list/get/replay/discard), following `checkpoint-postgres`'s exact `describe.skipIf(!dockerAvailable)` template |
| No OpenTelemetry instrumentation existed anywhere in the repository (confirmed by a repo-wide grep before starting) despite it being an explicit Section 149-152 requirement and the `observability` skill's standing rule | Added `tracing.ts` to both `agents` and `workflows` (`@opentelemetry/api`, explicit `Context` threading — see [Decisions](Phase_10_Decisions.md)); every agent run/model call/tool call/delegation/handoff and every workflow run/step/parallel-branch now gets a real, correctly-nested span; a retroactively-timed span for the cross-process approval wait; both verified with real `InMemorySpanExporter` assertions, not mocks |
| `AgentExecutionContext` was defined (`execution-context.ts`) with a doc comment describing it as the trusted-identity boundary, but was never constructed or used anywhere — `runtime.ts` threaded identity ad hoc through `AgentRunOptions` fields instead | `runtime.ts` now constructs a real `AgentExecutionContext` per run and attaches it to every tool call's `context.metadata`, alongside the already-resolved knowledge/memory scope |
| No `useAgentRun`/`useWorkflowRun` React hooks existed — `chat-store.ts`'s event switch already no-op'd every `agent.*`/`workflow.*` case with a comment marking this as deliberately deferred | Extended `ChatSnapshot` (four new fields), wired the existing switch's no-op cases to build real state, added six hooks mirroring `useToolCalls`/`useApprovals` exactly; 6 new tests in `agent-workflow-progress.spec.tsx` |
| No `docs/phases/phase-10/` files existed, despite ADR 0015 already citing two of them (`Phase_10_Decisions.md`, `Phase_10_Testing.md`) by name, and no Phase 10 examples existed at all | Wrote all ten required documents and all three required examples (`agent-basic`, `multi-agent`, `workflow-approval`), each with real, passing integration tests and a working `demo` script actually run this session |
| No re-authorization test proved a workflow `resume()` stops a caller whose permission was revoked between pause and resume, and no test literally proved a forged `{"approved": true}` value can't advance an approval step | Added `reauthorization.spec.ts` — a real `ActionFirewall` wired via `createActionFirewallMiddleware`, a revoked-vs-retained permission pair of tests, and two forgery-resistance tests (state-embedded `approved: true`, and a tool result's free-text field never influencing a condition step) |
| No test exercised agent-run cancellation (mid-model-call or mid-tool-call) or agent timeout, despite the code paths existing and being load-bearing | Added three tests to `runtime.spec.ts`; all passed on the first run, confirming the existing (untested) cancellation/timeout code was already correct |

## A behavior worth knowing, not a bug

**An orchestrator that declares no tools of its own silently gives every delegated
specialist zero tools, regardless of what the specialist itself declares.** This falls out
of `intersectToolNames`'s strict "intersection, never union" rule (ADR 0015 §3): a
delegated agent's effective tool set is the intersection of its own declaration and its
delegator's own currently-visible set, and an orchestrator with `tools: undefined` has an
empty visible set. This is a real, already-tested, deliberate design choice from the prior
session (stricter than the spec's own Section 55 prose, which frames authorization as
per-specialist-independent) — this review did not relitigate it, since changing it now would
invalidate `delegation-security.spec.ts`'s existing, correct assertions. Developers building
an orchestrator that never calls tools directly must still declare the **union** of every
specialist's tools as its own `tools` list, purely as a ceiling — `examples/multi-agent`
does this explicitly, with an inline comment explaining why.

## Deliberate scope decisions

- **No `@gixcopilot/observability` wrapper package.** `@opentelemetry/api` is added directly
  to `agents`/`workflows` — see [Decisions](Phase_10_Decisions.md) item 4.
- **No cross-process span propagation for approval waits** — recorded retroactively instead
  (Decisions item 5), not a live distributed trace.
- **No heartbeat/lease mechanism for `@gixcopilot/jobs`** beyond BullMQ's own
  attempts/stalled-job handling (Section 223 explicitly says "do not over-engineer
  distributed scheduling").
- **No Temporal adapter** (Section 114 explicitly excludes it) — the `JobExecutor` port is
  shaped so one could be added later without touching the core engine.
- **No visual/YAML workflow builder or DSL** (Section 165: "avoid YAML-only core APIs").
- **No agent-versioning/prompt-management platform** beyond the existing `AgentMetadata
  .version` field (Section 228, 230 explicitly defer the full platform to later phases).
- **No cost/budget enforcement beyond usage metadata already surfaced by Phase 2's model
  runtime** (Section 215 defers full budget policy to Phase 12).
- **No full DevTools/replay UI, evaluation platform, or Angular SDK** — out of Phase 10's
  scope per the task's own Section 2 boundary list.

## Supported limits

- **`Promise.allSettled`-based parallel workflow branches always run every branch to
  completion regardless of `partialFailurePolicy`** — a true early-abort "fail-fast" would
  need per-branch cancellation the engine does not implement for workflow parallel steps
  (this is a pre-existing, documented limitation in `engine.ts`, inherited unchanged; the
  AGENT-layer parallel delegation added this session DOES support real early-abort, since it
  controls its own child `AbortController`s directly).
- **A `@gixcopilot/jobs` worker process dying mid-step has no cross-process recovery for
  that specific in-flight closure** — the redelivered job completes as a no-op, and the
  workflow's own next `resume()` call (driven by the checkpoint, not the job queue) is the
  actual recovery path. Documented explicitly in `bullmq-job-executor.ts`'s own module
  comment.
- **`checkpoint-postgres` and `jobs`' integration suites require Docker** and auto-skip via
  `describe.skipIf(!dockerAvailable)` otherwise — both were run for real against genuine
  Redis/Postgres containers earlier in this session (see [Testing](Phase_10_Testing.md) for
  exact results); Docker was not reachable in this environment during the final validation
  pass, disclosed explicitly rather than assumed still-passing.
- **No example in this phase was run against a real OpenAI model this session** —
  `OPENAI_API_KEY` was not available in this environment. Every example supports
  `MODEL_PROVIDER=openai`/`OPENAI_API_KEY` (matching every prior phase's convention) but this
  was not exercised live; disclosed explicitly per Section 210-212's "record actual outcome,"
  not assumed.

Phase 11+ remains locked. A DevTools/replay platform, a full evaluation harness, and
production-platform features are planned phases, not Phase 10 technical debt.
