# Phase 10 decisions

[ADR 0015](../../adr/0015-agent-and-workflow-runtime-architecture.md) owns the agent/
multi-agent/workflow architecture and its own four headline decisions (package boundaries,
additive protocol extension, delegation-vs-handoff least privilege, "plans are not
authorization"). This document adds the decisions made while closing the gaps found in this
review — see [Issues](Phase_10_Issues.md) for how each gap was found.

1. **Knowledge/memory narrowing on delegation is declarative defense-in-depth, not a second
   access-control layer.** `@gixcopilot/agents` deliberately has no dependency on `rag`/
   `memory` (ADR 0015 §1), so it cannot itself enforce RAG/memory ACLs — that boundary stays
   entirely Phase 9's, driven by the trusted `SecurityContext` regardless of what any agent
   declares. `intersectKnowledgeSources`/`intersectMemoryTypes` narrow the *declared*
   `AgentKnowledgeConfig.sources`/`AgentMemoryConfig.types` the same way `intersectToolNames`
   already narrowed tools, and the narrowed result is attached to
   `ToolExecutionContext.metadata` so a knowledge/memory-performing tool gets it "for free" —
   but the real guarantee (a delegated agent cannot read another user's memory, cannot see a
   RAG source outside its ACL) was always structurally true anyway, by construction of Phase
   9's own retrieval/memory-service code, not because of anything Phase 10 adds.
2. **Parallel specialist dispatch is a same-turn model behavior, not a new public API.** When
   a single model turn requests more than one delegation and none of the turn's calls is a
   handoff, the runtime dispatches them concurrently instead of adding a
   `runtime.runParallel()` method — this fits the existing tool-calling loop exactly (a
   model can already request N tool calls in one turn; delegate calls are tool calls) and
   needed no new surface for an orchestrator or example to opt into.
   `AgentDelegationConfig.parallelFailurePolicy` (`'collect-results'` default,
   `'fail-fast'`) governs whether one delegation failing aborts its still-running siblings —
   real abort propagation via a dedicated per-batch `AbortController`, not merely a
   post-hoc outcome check.
3. **OpenTelemetry span parent-child linking uses explicit `Context` threading, not
   `startActiveSpan`'s ambient propagation.** Both `runtime.ts` and `engine.ts` are deep,
   already-heavily-tested recursive/async control flow; restructuring either into nested
   `context.with()` callbacks to get ambient propagation for free would have been high-risk
   for low benefit. Explicit `Context` values threaded through `AgentRunOptions
   .otelParentContext` and step-dispatch parameters give identical, directly-verified span
   nesting (`tracing.spec.ts` in both packages) with far smaller, more reviewable diffs.
4. **`@opentelemetry/api` is a direct dependency of both `agents` and `workflows`, not a new
   wrapper package.** The task's own Section 7 explicitly warns against unnecessary package
   fragmentation; `@opentelemetry/api` is API-only (no SDK/exporter), so duplicating its
   declaration across the two packages that actually need it costs nothing at runtime (a
   no-op tracer with nothing configured) and avoids inventing `@gixcopilot/observability` for
   what would have been a ~70-line wrapper used by exactly two callers.
5. **A workflow's approval-wait span is recorded retroactively, not held open.** A real
   approval wait spans a process boundary (`start()` returns while paused; `resume()` is a
   later, separate call) — there is no in-process span to keep open across that gap without
   persisting a live span/trace context in the checkpoint itself, which is out of scope here.
   `recordHistoricalSpan()` instead uses the persisted `ApprovalRequest`'s own `createdAt`
   and decision timestamp as the span's real start/end, satisfying the observability skill's
   "approval waits are visible and distinguishable from system latency" requirement without
   inventing cross-process span propagation.
6. **React's new agent/workflow state extends the existing per-provider `ChatSnapshot`**,
   populated by `chat-store.ts`'s pre-existing (previously no-op) event switch, rather than a
   new store/context. An agent/workflow run only ever exists within the scope of the SAME
   client run every other `ChatSnapshot` field already tracks; a separate subscription to
   the identical event stream would have been pure duplication for zero new capability.
7. **`packages/jobs`' BullMQ/Redis integration test uses `@testcontainers/redis` against a
   real Redis**, mirroring `checkpoint-postgres`'s and `vectorstore-pgvector`'s existing
   `@testcontainers/postgresql` pattern exactly — both dependencies (`bullmq`,
   `@testcontainers/redis`) were already declared by the prior session but never actually
   exercised by any test.
8. **All three Phase 10 examples reuse `createAgentTestHarness`/`createWorkflowTestHarness`
   in their own integration tests**, the same zero-network/zero-DB test rigs every package
   spec is built on, rather than each example inventing its own scaffolding — this is also
   why every example's tests run in well under a second with no Docker/credentials
   requirement.

Standards consulted: the `observability` skill's span/correlation requirements, the
`dependency-policy` skill's justify-before-adding rule, and the task's own Section 7 ("avoid
unnecessary package fragmentation"). The implementation documents its supported subset (see
[Issues](Phase_10_Issues.md)) rather than claiming a fully general-purpose framework.
