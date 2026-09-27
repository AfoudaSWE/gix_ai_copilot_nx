# Technical Debt

> This file did not exist before Phase 2. It tracks _real_ debt — shortcuts taken that
> should be paid down — as distinct from features deliberately deferred to a later phase
> (which belong in the phase's own "Non-responsibilities" / "Known Limitations" sections,
> not here; deferring a Phase 5 feature during Phase 2 is not debt, per Section 59).

## Open Items

1. **Compiled test files ship in `dist/`.** Every package's `tsconfig.json` includes its own
   `*.spec.ts` in the same program as its source, so `dist/` contains compiled spec files
   alongside real source. Harmless today (nothing outside `.` is importable per each
   package's `exports` field, and nothing is actually published), but should be split into
   separate build/typecheck tsconfigs before any real npm publish. _(Since: Phase 1)_

2. **`ModelRuntime` retry backoff uses real timers.** Tests keep this fast by setting
   `baseDelayMs: 0, maxDelayMs: 0` rather than mocking time, which works today but means a
   test that forgets to override the default policy will run slowly (not incorrectly — see
   the fix made to `model-executor.spec.ts` during Phase 2 validation). Consider an
   injectable clock/sleep function if this becomes a recurring test-authoring footgun.
   _(Since: Phase 2)_

3. **The server's run registry is process-local and in-memory.** Documented as a known
   limitation (not deferred debt exactly, but worth tracking here too): a multi-instance
   deployment cannot route a cancel request to whichever instance holds the run. Phase 12 supports
   independent runs on multiple instances but still needs routing affinity for cancel and
   frontend tool-result requests; see [Scaling](production/SCALING.md).
   _(Since: Phase 1; still open in Phase 12)_

Phase 4 review: no new debt was introduced. `@gixcopilot/context` ships with the same
per-package `*.spec.ts`-in-`dist/` characteristic as item 1 above (not additional debt, the
same pre-existing pattern); its `files` field already excludes compiled specs, matching
Phase 3's own fix. No Phase 5+ feature (tools, RAG, agents, security firewall) is tracked
here — see Section 85 of the phase brief and the phase-gate skill.

Phase 5 review: no new debt was introduced. `@gixcopilot/tools` ships with the same
per-package `*.spec.ts`-in-`dist/` characteristic as item 1 (its `files` field excludes
compiled specs, matching prior packages). `@gixcopilot/server`'s new `FrontendToolBridge` is
in-memory and process-local, exactly like the pre-existing run registry (item 3) — tracked
there, not as new debt. Two real bugs (a tool-event drain gap on a thrown error, and a
frontend-tool round-trip deadlock) were found and _fixed within this same phase_ via
integration testing — see `docs/phases/phase-05/Phase_5_Issues.md` — so neither is carried
forward as debt. No Phase 6+ feature (Generative UI, an Action Firewall, HITL, OpenAPI/MCP
auto-tool-generation, RAG, agents) is tracked here.

Phase 6 review: no new debt was introduced. `@gixcopilot/generative-ui` ships with the same
per-package `*.spec.ts`-in-`dist/` characteristic as item 1 (its `files` field excludes
compiled specs, matching every prior package). Two real bugs (a tool-name-sanitization crash
for kebab-case/snake_case ids, and a render-error-isolation gap that let a throwing custom
renderer take down the whole chat instead of one row) were found and _fixed within this same
phase_ via unit/integration testing — see `docs/phases/phase-06/Phase_6_Issues.md` — so
neither is carried forward as debt. The state-patch contract intentionally supports only
`'set'`/`'merge'` (no array/nested-path operations) — a deliberate, documented scope
decision (Section 42's "avoid an excessively powerful expression language"), not debt. No
Phase 7+ feature (Action Firewall, RBAC/ABAC, approval/HITL, OpenAPI/MCP, RAG, agents) is
tracked here.

Phase 7 review: no new _categories_ of debt were introduced. `@gixcopilot/security` ships
with the same per-package `*.spec.ts`-in-`dist/` characteristic as item 1 (its `files` field
excludes compiled specs). `createInMemoryApprovalStore`/`createInMemoryAuditSink` and the
in-memory rate limiter are process-local, the same documented limitation as the pre-existing
run registry and frontend-tool bridge (item 3) — a multi-instance deployment needs a shared
approval store/audit sink/limiter; no action needed until a phase actually requires
horizontal scaling. Several real bugs were found and fixed during implementation via
integration testing — see `docs/phases/phase-07/Phase_7_Issues.md` for the full list,
including: a discovery-vs-execution metadata lookup that let a permission-hidden tool's
security requirements become invisible to the firewall at execution time (turning a should-
be-denied manual call into a silently-created, never-resolved approval); a frontend
`tool.requested` event that was announced during firewall evaluation instead of after
authorization/approval succeeded, which would have let a denied or approval-pending frontend
action execute in the browser immediately; and a revalidation bug that treated the firewall's
stateless re-derivation of the _same_ approval requirement as an automatic denial, which
would have blocked every approved action from ever executing. None is carried forward as
debt — all three are fixed and covered by regression tests. No Phase 8+ feature (OpenAPI/MCP
auto-tool-generation, RAG, agents) is tracked here.

Phase 8 review: the generated build/test-output and process-local storage limitations above also apply to the new integration packages. The completion review fixed firewall, credential, schema, HTTP and MCP lifecycle defects; these are not carried forward as debt. Resource/prompt pagination and custom-client disconnect handling limits are recorded below and in [Phase 8 issues](phases/phase-08/Phase_8_Issues.md). No planned Phase 9 capability is classified as technical debt.

## Resolved

Phase 3 review: the new React/UI package file lists exclude compiled specs from packing.
The older package test-output cleanup in item 1 remains open. Phase 3 does not add a
virtualization/throttling framework without measurements; long-history performance remains
an explicit validation limit in `docs/phases/phase-03/Phase_3_Issues.md`, not a promised
optimization. No Phase 4+ feature is tracked as Phase 3 debt.

- ~~Server cancelled every run almost immediately due to listening for client-disconnect on
  the wrong stream (`request.raw` instead of `reply.raw`).~~ Fixed during Phase 1
  validation — see `docs/adr/0004-sse-as-initial-streaming-transport.md`.
- ~~The OpenAI SDK's own built-in retry logic was fighting with `ModelRuntime`'s retry
  policy, causing real, uncontrolled backoff delays.~~ Fixed during Phase 2 validation by
  setting `maxRetries: 0` on the OpenAI client — see
  `packages/providers/openai/src/openai-provider.ts`.

## Phase 8 completion-review limits

MCP resource/prompt discovery currently returns one page and resource reads return the first text item. Custom MCP clients without state subscriptions require explicit host cleanup. The OpenAPI converter supports a documented subset and rejects unsupported constructs; no full conformance claim is made. Concrete security defects found in review were fixed, rather than carried forward as debt. See [Phase 8 issues](phases/phase-08/Phase_8_Issues.md) for scope and operational limits. Planned Phase 9 capabilities remain outside this debt list.

## Phase 9 completion-review limits

One baseline reranker ships (`createSimilarityReranker`); the `Reranker` interface supports a
cross-encoder/LLM/provider reranker, but none is implemented. No hybrid keyword+vector search
and no query rewriting/expansion are implemented — deterministic vector-only retrieval is the
Phase 9 baseline. Memory's default per-type retention (1h/24h/90d/90d) is a documented default an
explicit `expiresAt` always overrides, not a regulatory-compliance-grade retention product.
`createMemoryService`'s audit write is best-effort (a sink failure does not block the underlying
operation), matching Phase 7's own audit-sink tradeoff. No S3/Azure Blob/GCS-specific
object-storage adapter and no natural-language-to-SQL database source were implemented — both are
explicitly out of Phase 9's scope (Section 22/23), not deferred work. Concrete defects found in
review (a broken `pnpm-workspace.yaml` install scaffold, an entirely-unimplemented
`@gixcopilot/memory` package, a real pgvector SQL operator-precedence bug) were fixed rather than
carried forward as debt. See [Phase 9 issues](phases/phase-09/Phase_9_Issues.md) for the complete
scope and operational limits. Planned Phase 10+ capabilities (agents, multi-agent orchestration,
DevTools, Angular, an enterprise management platform) remain outside this debt list.

## Phase 10 completion-review limits

Workflow `parallel` steps always run every branch to completion (`Promise.allSettled`); only
agent-level parallel delegation supports true early-abort fail-fast. An orchestrator must
declare the union of its specialists' tools as its own `tools` ceiling, because delegation
intersects tool sets and never unions them. An approval wait is recorded as a retroactive span,
not a live cross-process trace. `@gixcopilot/jobs` relies on BullMQ's own attempts and
stalled-job handling, with no custom heartbeat/lease, and a closure scheduled in one process
cannot be replayed from another after a crash; durable recovery comes from checkpoints plus
`resume()`. BullMQ queue latency and Postgres checkpoint latency have functional
Testcontainers coverage but no benchmark. No Temporal adapter, visual/YAML workflow builder,
prompt-management platform, or budget enforcement beyond Phase 2 usage metadata; these are
Phase 11/12 scope, not debt. See [Phase 10 issues](phases/phase-10/Phase_10_Issues.md).

## Phase 11 completion-review limits

The Phase 5 tool runtime rejects a timed-out tool call but does not abort the signal passed to
the tool, so a timed-out tool keeps running; found through Phase 11 tool mocks and left
unchanged because it is Phase 5 behavior. Approval-wait spans are separate traces joined by run
id, not nested under the request. Tenant-scoped DevTools live streaming re-projects the session
per event. The recording adapter is a bounded in-memory ring buffer, not durable storage or
audit retention. Groundedness is a lexical evidence-overlap heuristic, and an LLM judge is
optional and also heuristic. Recorded replay requires a payload-capturing recording and can
diverge when a replay takes a different path. There is no CLI (`pnpm eval` is the foundation;
the CLI is Phase 12), and manual tool execution from DevTools is intentionally not provided. See
[Phase 11 issues](phases/phase-11/Phase_11_Issues.md).

