# Project Status

> This file did not exist before Phase 2. Phase 1 recorded its status via
> `docs/architecture/overview.md` and `docs/adr/*`; those remain the source of truth for
> Phase 1's design record (a `docs/phases/phase-01/` index was added later, on request, but
> defers to the same ADRs). This file is the ongoing, phase-by-phase status tracker going
> forward, per Phase 2's documentation requirements.

## Phase Status

```text
Phase 01 - Foundation & Architecture           COMPLETE
Phase 02 - LLM Runtime & Streaming             COMPLETE
Phase 03 - React Copilot UI                    COMPLETE
Phase 04 - Application Context & State         COMPLETE
Phase 05 - Tools & Agent Actions               COMPLETE
Phase 06 - Generative UI & Shared State        COMPLETE
Phase 07 - Enterprise Security & HITL          COMPLETE
Phase 08 - OpenAPI + MCP + Integrations        COMPLETE
Phase 09 - Knowledge + RAG + Memory            COMPLETE
Phase 10 - Agents + Multi-Agent + Workflows    COMPLETE
Phase 11 - DevTools + Testing + Evals + Obs.   COMPLETE
Phase 12 - Production Platform + Ecosystem     COMPLETE
```

Phase progression is explicitly controlled by the user — see the `phase-gate` skill. No
phase is started without an explicit instruction naming it.

## Phase 1 — Foundation & Architecture (COMPLETE)

- `@gixcopilot/protocol`, `@gixcopilot/core`, `@gixcopilot/client`, `@gixcopilot/server`
  established, proving `Client -> HTTP -> Server -> Core -> SSE -> Client` end to end with
  a deterministic (non-AI) executor.
- Full record: `docs/architecture/overview.md`, `docs/adr/0001`–`0005`,
  `docs/phases/phase-01/`, `examples/protocol-demo/`.

## Phase 2 — LLM Runtime & Streaming (COMPLETE)

- Added `@gixcopilot/provider`, `@gixcopilot/provider-mock`, `@gixcopilot/provider-openai`: a
  provider-independent model runtime with retry, timeout, cancellation, usage, latency, and
  normalized errors, bridged into `@gixcopilot/core`'s existing `Executor` boundary.
- `@gixcopilot/server` and `@gixcopilot/client` extended additively (`model` field, `messages`
  array) — a request with no `model` still runs exactly as it did in Phase 1.
- Full record: `docs/phases/phase-02/`, `docs/adr/0006-model-provider-abstraction.md`,
  `examples/model-streaming/`.

## Phase 3 — React Copilot UI (COMPLETE)

- Added `@gixcopilot/react`: provider, headless chat/message/status/thread hooks and stable
  actions over the existing client. No React or UI dependencies added to core/client.
- Added `@gixcopilot/ui`: composable chat/popup/sidebar, safe Markdown/code, themes,
  responsive RTL layout, accessible focus/input/live-region behavior and customization.
- Added styled/headless React examples, real-stack integration and Chromium browser tests.
- Full record: [Phase 3 docs](phases/phase-03/Phase_3_Docs.md),
  [completion report](phases/phase-03/Phase_3_Status.md), ADRs 0007–0008.

## Phase 4 — Application Context & State (COMPLETE)

- Added `@gixcopilot/context`: a framework-independent context registry/engine (scopes,
  priority, sensitivity metadata, controlled serialization, token budgeting/truncation,
  deduplication, diagnostics) and a shared, typed state store — depends only on
  `@gixcopilot/protocol`, no React/provider dependency.
- Extended `@gixcopilot/react` with `useCopilotContext`/`useCopilotState`/
  `useCopilotContextDebug`, wired into every `CopilotProvider` automatically; resolved
  context reaches real model requests as a leading `system` message, verified through the
  real client → server → core → model-runtime pipeline. No protocol/core/server change.
- Added `examples/react-context`: an application-aware chat example with a deterministic,
  non-network context-aware provider and a mandatory end-to-end test.
- Full record: [Phase 4 docs](phases/phase-04/Phase_4_Docs.md),
  [completion report](phases/phase-04/Phase_4_Status.md),
  [ADR 0009](adr/0009-context-and-state-architecture.md).

## Phase 5 — Tools & Agent Actions (COMPLETE)

- Added `@gixcopilot/tools`: a framework-independent canonical tool architecture —
  `ToolDefinition`/`defineTool`, a registry, a discovery resolver, and an execution runtime
  (validate → middleware → timeout/cancellation → execute → validate output → normalize) —
  depends only on `@gixcopilot/protocol`, no React/Fastify/provider-SDK dependency.
- Extended the protocol additively: `ToolCall`/`ToolResult`/`ToolManifestEntry` types, two new
  `ContentPart` variants, four new `tool.*` `CopilotEvent`s, a new `FinishReason` value, and
  six new `CopilotErrorCode`s. Extended `@gixcopilot/core`'s `ExecutorContext` with an
  optional `onToolEvent` callback rather than widening `Executor.execute()`'s yield type —
  every Phase 1/2 `Executor` is untouched.
- Extended `@gixcopilot/provider` (provider-core), `-mock`, and `-openai` with provider-neutral
  tool calling (`ModelRequest.tools`, `tool_call.requested` streaming, a fragmented-argument
  assembler) and a new `generateObject()` structured-output API, distinct from tool calling.
- Extended `@gixcopilot/server` with a real Model → Tool → Model loop
  (`createToolCallingExecutor`), a backend `toolRegistry` option, and a
  `POST /runs/:runId/tool-results` route + `FrontendToolBridge` for frontend tool round trips.
- Extended `@gixcopilot/client` (`submitToolResult`) and `@gixcopilot/react`
  (`useFrontendTool`, `useToolCalls`, per-provider frontend tool registry/runtime) and
  `@gixcopilot/ui` (a generic, overridable `ToolActivity` component).
- Added `examples/react-tools`: demonstrates backend tool, frontend tool, context + tool,
  tool error, and tool cancellation end to end, using a deterministic, non-network provider.
- Full record: [Phase 5 docs](phases/phase-05/Phase_5_Docs.md),
  [completion report](phases/phase-05/Phase_5_Status.md),
  [ADR 0010](adr/0010-canonical-tool-architecture.md).

## Phase 6 — Generative UI & Shared State (COMPLETE)

- Added `@gixcopilot/generative-ui`: a framework-independent trusted component registry,
  the reserved-tool bridge (`ui.render.<component>`) that carries a "structured UI request"
  entirely over the canonical Phase 5 tool-calling pipeline, the state-patch tool bridge
  (`state.patch.<id>`), and a progress-step mapping utility — depends only on protocol/tools/
  context, no React dependency.
- Extended `@gixcopilot/context`'s existing `CopilotStateStore` in place: `modelWritable`,
  per-slot `revision`, and a validated, non-throwing `applyPatch()` pipeline (conflict/
  rejection handling) — no new package for shared state.
- Extended `@gixcopilot/react` with `useGenerativeComponent`, `useToolRenderer`,
  `useResolveToolRenderer`, `useGenerativeUIRequests`, `useInvokeTool`, and
  `useCopilotState`'s new `modelWritable` option, all wired into every `CopilotProvider`
  automatically.
- Extended `@gixcopilot/ui`'s `ToolActivity` with per-row render-error isolation and a
  `resolveRenderer` hook-up, so a registered generative component or custom tool renderer
  appears automatically in the default `CopilotChat` UI.
- **No file under `protocol`, `core`, `client`, `server`, or any provider package was
  modified** — generative UI rendering and AI-writable state patching both reuse the exact
  frontend-tool round trip Phase 5 already built.
- Added `examples/react-generative-ui`: component rendering (single/multiple), an unknown-id
  fallback, a direct interactive action, a valid AI state patch, and the stale-revision
  conflict path, all verified end to end.
- Full record: [Phase 6 docs](phases/phase-06/Phase_6_Docs.md),
  [completion report](phases/phase-06/Phase_6_Status.md),
  [ADR 0011](adr/0011-generative-ui-and-state-patch-architecture.md).

## Phase 7 — Enterprise Security & HITL (COMPLETE)

- Added `@gixcopilot/security`: a framework-independent AI Action Firewall — trusted
  identity/tenant boundary, RBAC + ABAC policy engine, risk classification, a five-level
  human-in-the-loop approval state machine (user confirmation, supervisor, admin,
  two-person), dry-run/preview, PII redaction, rate limiting, and an audit trail. Depends
  only on protocol + tools.
- The firewall's canonical enforcement boundary is `@gixcopilot/server`'s tool-calling
  executor dispatch step (covers backend, frontend, and direct-invoked actions identically,
  in a two-pass design so a minutes-long approval wait never blocks the client from seeing
  the prompt), with a second `ToolRuntimeMiddleware` layer for defense in depth.
- Extended the protocol additively: a `security`/dry-run-preview manifest shape, four new
  `approval.*` events, nine new error codes — no Phase 1–6 request/response shape changed.
- `useInvokeTool()` (Phase 6) now routes through the same server-side firewall once one is
  configured, closing the "a generated button bypasses the model, therefore the firewall"
  gap; `@gixcopilot/client`/`@gixcopilot/react` gained `decideApproval`/`getHeaders`/
  `useApprovals` family; `@gixcopilot/ui` gained accessible `ApprovalCard`/`SecurityDenial`
  components (verified with a real `axe-core` scan).
- Added `examples/react-enterprise`: five tools spanning every risk/approval tier, a real
  tenant + business-rule ABAC policy, dry-run previews, PII redaction, and (optionally) real
  OpenAI chat through the identical firewall as its own direct-action buttons — no fake
  model logic in the real execution path. Manually verified live over real HTTP this
  session: permission denial, tenant isolation, PII redaction, self-approve rejection,
  real supervisor approval, actual mutation execution, and a populated audit trail.
- Full record: [Phase 7 docs](phases/phase-07/Phase_7_Docs.md),
  [completion report](phases/phase-07/Phase_7_Status.md),
  [ADR 0012](adr/0012-action-firewall-and-hitl-architecture.md).

## Phase 8 — OpenAPI + MCP + Integrations (COMPLETE)

- Added `@gixcopilot/openapi`: loads/validates/resolves an OpenAPI 3.0/3.1 document, discovers
  operations, derives deterministic dot-namespaced tool names, converts parameters/request/
  response bodies into Zod (including `readOnly`/`writeOnly` direction-aware handling and
  declared-response validation), applies an exposure policy that requires deliberate
  selection (`include`/`operations`) rather than ever auto-activating a whole spec, maps that
  into the same `ToolSecurityManifest` every hand-written tool uses, executes over a
  from-scratch SSRF-safe HTTP executor (trusted base URL + escaped path/query values, redirect
  refusal, dot-segment rejection, bounded response size, credential-header precedence over any
  model-supplied header), and normalizes results/errors into the existing `CopilotError`
  taxonomy. `inspectOpenAPI`/`registerOpenAPI` are the preview/live entry points; `refresh()`
  reconciles a changed spec by content digest without ever silently overwriting a conflict.
- Added `@gixcopilot/mcp`: a project-owned wrapper around the official
  `@modelcontextprotocol/sdk` (confined to one file — no SDK type crosses the public
  boundary), an explicit connection lifecycle, tool/resource/prompt discovery, `mcp.<server>.
  <tool>` namespacing, and a **deny-by-default** exposure policy — an MCP tool is never
  exposed just because the server offers it, and a malicious tool description/result carries
  no special authority. `registerMCP` connects (bounded, backoff reconnect), generates, and
  registers tools identically to `registerOpenAPI`.
- Added `@gixcopilot/integrations`: a small in-memory registry tracking OpenAPI/MCP/future
  connectors uniformly, deliberately not a management platform.
- `jsonSchemaToZod`, `toToolNameSegment`, `CredentialProvider`/credential-redaction, and a new
  safe `measureIntegration` telemetry helper live in `@gixcopilot/tools`, shared by both
  source packages instead of duplicated. `@gixcopilot/security`/`@gixcopilot/server` gained a
  small, additive extension: a server with no configured Action Firewall now refuses to
  execute an OpenAPI/MCP-sourced tool at all (fails closed) rather than silently allowing it
  through, and audit records carry safe source metadata (integration/operation/server/
  duration/external status) alongside the existing decision/approval trail — no protocol
  event or wire-shape change.
- **No file under `protocol`, `core`, `client`, or any provider package was modified** —
  generated tools register into the exact same `ToolRegistry`/`ToolRuntime` Phase 5 built and
  are enforced by the exact same Action Firewall Phase 7 built.
- Added `examples/openapi` and `examples/mcp`: each wires a real local API/MCP server, a real
  Action Firewall + approval store + audit sink, and an explicit, reviewed tool selection
  (no permission-loosening defaults) — proving the full chain (discovery → policy →
  permission-gated generation → real HTTP/MCP execution → model response) end to end,
  including a live supervisor-approval round trip for a generated write tool and a mixed
  native/frontend/backend/OpenAPI/MCP catalog correctly filtered per caller. A dedicated
  governance/security-hardening test suite additionally proves a malicious MCP tool
  description/result cannot grant itself authority, a server with no firewall configured
  refuses every external tool call, and PII/secret fields are redacted from a tool result
  before the model ever sees them.
- Full record: [Phase 8 docs](phases/phase-08/Phase_8_Docs.md),
  [completion report](phases/phase-08/Phase_8_Status.md),
  [ADR 0013](adr/0013-openapi-mcp-integration-architecture.md).

## Phase 9 — Knowledge + RAG + Memory (COMPLETE)

- Added `@gixcopilot/knowledge`: framework-independent source/document/loader contracts —
  `text`, `markdown` (heading-aware), `pdf` (via `pdfjs-dist`, page/title provenance), `docx`
  (via `mammoth`, heading/paragraph/table-aware), `html`/`web` (via `node-html-parser`,
  SSRF-guarded — `assertSafeWebUrl` blocks loopback/link-local/private ranges and non-HTTP(S)
  schemes, refuses redirects, bounds response size), `api` (developer-configured, never
  model-controlled), `database` (a predefined safe query, no natural-language-to-SQL),
  `object-storage` (a generic client shape, no cloud SDK dependency), and `mcp-resource`
  (reuses Phase 8's `McpClient`, not a second connection). Depends only on protocol + `mcp`.
- Added `@gixcopilot/rag`: structure-aware recursive chunking with deterministic chunk IDs, a
  provider-neutral `EmbeddingProvider` (deterministic test adapter + real OpenAI adapter), a
  storage-agnostic `VectorStore` contract (in-memory + pgvector implementations), an indexer
  (index/reindex/delete, atomic reindex via `VectorStore.replace`), a **permission-aware
  retriever** that enforces tenant + ACL (SQL pre-filter and application post-filter, defense
  in depth) + ABAC before reranking, a baseline similarity reranker, stable `[S#]` citation
  assignment with post-hoc validation against unknown IDs, and `formatKnowledgeContext` — a
  plain, duck-typed contribution for the *existing* Phase 4 `ContextEngine` (no second
  prompt-construction engine; `rag` never imports `@gixcopilot/context`). Depends only on
  protocol + security + knowledge; never PostgreSQL.
- Added `@gixcopilot/vectorstore-pgvector`: the only package depending on `drizzle-orm`/`pg`,
  implementing `VectorStore` against PostgreSQL + pgvector with a real SQL-level ACL filter
  (enforced before `LIMIT`, fails closed on a malformed ACL shape), an HNSW cosine index, and
  two logically separate table sets (`knowledge_chunks`/`memory_embeddings`) selected by a
  `table` option — proven against a real Postgres 16 + pgvector database via Testcontainers.
- Added `@gixcopilot/memory`: an explicit taxonomy — working/session/durable/semantic, kept
  distinct from conversation history and from RAG — with mandatory ownership
  (`user`/`session`/`tenant`/`workspace`/`application`) derived only from a trusted
  `SecurityContext`, an in-memory store and a persistent store built on rag's own
  `VectorStore`/`EmbeddingProvider` (a separate table, not the knowledge index), a default
  write policy that rejects credential-shaped values before they reach storage, bounded
  per-type retention, and `createMemoryService` (explicit-confirmation persistence + audit).
  Durable memory registers into the Context Engine at a fixed `'normal'` priority — one tier
  below every `'critical'` system instruction — so it can never outrank the current explicit
  instruction. Depends only on protocol + security + rag.
- Extended `@gixcopilot/react` (`useCitations`) and `@gixcopilot/ui`
  (`<Citation />`/`<CitationList />`/`<SourcePreview />`) with headless citation UI, duck-typed
  against plain data with **no dependency on `@gixcopilot/rag`/`@gixcopilot/memory`** —
  retrieval and authorization already happened server-side by the time anything reaches the
  browser. Promoted `createToolCallingExecutor`/`createFrontendToolBridge` from
  `@gixcopilot/server`'s internals to its public API (both were already fully implemented and
  tested; `createServer` already composed them internally).
- Added `examples/react-rag`: three tenant/permission-tiered knowledge documents (public
  handbook, supervisor guide, admin-only security procedure), a `RagService` wiring real
  retrieval + memory + the real Context Engine + the real AI runtime, explicit memory
  save/view/forget HTTP routes deriving owner/tenant from server identity only, a browser UI,
  and an integration suite proving the **mandatory critical security test** (a viewer's
  question whose answer exists only in the admin document never reaches the model, and never
  appears in the actual runtime request), citation-validity checking, memory
  ownership/tenant/expiration/deletion, current-instruction-wins precedence, MCP resource
  ingestion through the identical ACL pipeline, and prompt-injection containment through the
  unmodified Phase 7 Action Firewall — plus a `smoke.ts` real-provider script, **actually run
  this session** against real OpenAI (chat + embeddings) and a real, disposable
  PostgreSQL + pgvector database; see [real-smoke.json](phases/phase-09/real-smoke.json).
- **No file under `protocol`'s `Message`/`ContentPart`/`Run`/event shapes was modified** —
  only the additive `CopilotErrorCode` taxonomy grew (Section 129: `SOURCE_LOAD_FAILED`,
  `PARSE_FAILED`, `CHUNK_FAILED`, `EMBEDDING_FAILED`, `VECTOR_STORE_FAILED`, `INDEX_FAILED`,
  `RETRIEVAL_FAILED`, `MEMORY_WRITE_DENIED`, `MEMORY_READ_DENIED`).
- Two real bugs were found and fixed during this review: a SQL operator-precedence bug in
  pgvector's `search()` threshold condition (caught by a genuine Testcontainers-backed
  integration test), and a broken `pnpm-workspace.yaml` scaffold that hard-failed
  `pnpm install` and blocked every `nx` command before any Phase 9 work could be validated.
- Full record: [Phase 9 docs](phases/phase-09/Phase_9_Docs.md),
  [completion report](phases/phase-09/Phase_9_Status.md),
  [ADR 0014](adr/0014-knowledge-rag-memory-architecture.md).

## Phase 10 — Agents + Multi-Agent + Workflows (COMPLETE)

- Added `@gixcopilot/agents`: a framework-independent agent runtime — `AgentDefinition`/
  `defineAgent`, a disposable-handle registry, a think/act/observe execution loop with
  iteration/tool-call/delegation/depth/timeout limits (chain-wide budget tracking,
  cancellation propagating into in-flight model/tool/child-run calls), deterministic and
  model-based routing (validated against a caller allowlist, prompt-injection-resistant),
  least-privilege delegation (`A → B → A`, tool/knowledge/memory scope intersected — never
  unioned — across every hop) and handoff (`A → B`, validated only against a static
  developer-declared graph), same-turn parallel specialist dispatch with a real
  `'fail-fast'`/`'collect-results'` policy, a minimal multi-agent message bus, and a
  planner/executor pair (`generateObject()`-backed, Zod-validated plans that grant no
  authorization of their own — a planned deletion is still denied by the unmodified Action
  Firewall). Depends only on `protocol`/`core`/`tools`/`provider`/`security` (type-level) —
  never `rag`/`memory`/`context` directly; knowledge/memory scoping is declarative data a
  composition layer uses to build knowledge/memory-performing tools, exactly like every
  other RAG/memory consumer in this codebase.
- Added `@gixcopilot/workflows`: a deterministic workflow engine — `defineWorkflow`,
  registration-time DAG validation, six step types (function/tool/agent/approval/condition/
  parallel), checkpointing after every step, idempotent version-checked `resume()`, retry
  (retryable-vs-not classification with backoff) and compensation (reverse-order,
  best-effort), tenant isolation, and re-authorization on resume (a caller whose permission
  was revoked between pause and resume is denied at the next consequential step, never
  silently allowed through on stale authorization). Approval steps bridge into the
  *existing* Phase 7 `ApprovalStore`/Action Firewall — no second approval engine; a forged
  in-band `"approved": true` value (in a tool result or in workflow state itself) is
  structurally inert, proven directly. `CheckpointStore`/`JobExecutor` are ports with
  in-memory/inline defaults — the engine never requires Redis or Postgres to run.
- Added `@gixcopilot/checkpoint-postgres` (real Drizzle/Postgres `CheckpointStore`,
  optimistic-concurrency/stale-write-rejection, Testcontainers-verified) and
  `@gixcopilot/jobs` (real BullMQ/Redis `JobExecutor` with deterministic idempotent job ids
  and a dead-letter inspector, also Testcontainers-verified) — genuine adapters, not stubs,
  mirroring `vectorstore-pgvector`'s relationship to `rag`'s `VectorStore` contract.
- Both `agents` and `workflows` gained real OpenTelemetry instrumentation
  (`@opentelemetry/api`, a no-op tracer when unconfigured) — correctly-nested spans for
  every agent run/model call/tool call/delegation/handoff and every workflow run/step,
  including a retroactively-timed span for a workflow's cross-process approval wait, all
  directly verified against a real `InMemorySpanExporter`.
- Extended `@gixcopilot/react` with six new headless hooks (`useAgentRun(s)`,
  `useAgentDelegations`, `useAgentHandoffs`, `useWorkflowRun(s)`) on the *existing*
  per-provider `ChatSnapshot` — no new store, provider, or protocol change; the event switch
  these hooks read from was already wired by the prior session, previously a deliberate
  no-op.
- Added `examples/agent-basic` (single agent, a real tool, real RAG retrieval, real memory,
  and a trusted security context), `examples/multi-agent` (orchestrator plus three
  differently-scoped specialists, real same-turn parallel delegation, a mandatory
  privilege-isolation security test), and `examples/workflow-approval` (validate → agent
  step → payment check → real human approval pause/resume → update, including a genuine
  two-independent-engine-instance "process restart" test) — each with passing deterministic
  integration tests and a real `demo` script actually run this session.
- A systematic gap audit against the original task found and closed real gaps in the prior
  session's draft: knowledge/memory narrowing was declared but never enforced; parallel
  specialist dispatch was entirely unimplemented (an orphaned empty directory was the only
  trace); `@gixcopilot/jobs` had zero test coverage despite already declaring its Redis
  dependencies; no OpenTelemetry instrumentation existed anywhere in the repository; no
  React hooks, examples, or `docs/phases/phase-10/` files existed at all despite ADR 0015
  already citing two of the latter by name; and a broken `pnpm-workspace.yaml` placeholder
  value was hard-failing `pnpm install` for the entire repository. See
  [Issues](phases/phase-10/Phase_10_Issues.md) for the full list with evidence.
- Full record: [Phase 10 docs](phases/phase-10/Phase_10_Docs.md),
  [completion report](phases/phase-10/Phase_10_Status.md),
  [ADR 0015](adr/0015-agent-and-workflow-runtime-architecture.md).

## Phase 11 — DevTools + Testing + Evals + Observability (COMPLETE)

- `@gixcopilot/telemetry` (begun before this session) completed: span-only head sampling,
  structured logs, browser-safe ids. Two redaction bugs fixed: token counts and retrieval ACL
  counts had been blanked as `[REDACTED]`. Agents and workflows now record their events and run
  facts (visible tools, model, limits, step graph) to the internal diagnostics channel. The
  public protocol is unchanged.
- `@gixcopilot/devtools`: read-only, tenant- and subject-scoped inspectors for runs, messages,
  context budget, state history, tools with firewall trail, generative UI, RAG, citations,
  memory, agent tree, delegations and handoffs, workflow graph, events, traces and errors.
  Also safe debug bundles, and an opt-in, authenticated, production-refusing, read-only
  Fastify transport.
- `apps/devtools`: an accessible React DevTools UI (keyboard tablist, focus management, RTL,
  reduced motion, responsive), verified in Chromium.
- `@gixcopilot/testing`: request-aware test models with failure simulation; tool mocks and
  assertions; real-stack security, RAG, memory and approval fixtures; agent and workflow
  simulation; a copilot harness; and replay that never repeats side effects.
- `@gixcopilot/evals`: versioned datasets, execution records derived from recordings, 24
  deterministic evaluators plus an optional LLM judge, reports, baseline comparison,
  experiments, and CI gates in which security is an unconditional hard gate.
- `examples/devtools` (one app, one inspected session, execution-generated trace) and
  `examples/evals` (deterministic and live evaluation, with adversarial cases).
- Found through tests and a real browser run, and fixed: DevTools resume projection,
  firewall-blocked calls missing from the tool view, cross-run tool-call id joins, and an
  O(runs x events) projection (588 ms to 6 ms on 23,000 events).
- Records: [Phase 11 docs](phases/phase-11/Phase_11_Docs.md),
  [completion report](phases/phase-11/Phase_11_Status.md), ADRs
  [0016](adr/0016-telemetry-and-diagnostics-architecture.md) to
  [0019](adr/0019-evaluation-model-and-security-hard-gates.md).

## Phase 12 — Production Platform + Ecosystem (COMPLETE)

- Implemented Angular and Node SDKs over shared headless state, a CLI with four starter templates, validated configuration and secret references, tenant-scoped PostgreSQL persistence, Redis workers and limits, model routing/fallback, usage admission, an authenticated management API and platform, Docker deployment, CI/release workflows, and a documentation portal.
- The post-upgrade 64-project `pnpm validate` gate passed (235 of 254 tasks executed, 19 cached). Real PostgreSQL/Redis suites, 11 Chromium tests, all eight initial clean tarball consumers and the upgraded enterprise starter passed. See [Phase 12 testing](phases/phase-12/Phase_12_Testing.md) for exact results and limits.
- The owner reversed the earlier proprietary decision: packages are MIT licensed and published to npm from the `gixtech` account; see [Releasing](RELEASING.md). The owner confirmed revocation and rotation of the previously committed real credential and completion of the exposure review. The production audit prompted an upgrade to patched Drizzle ORM 0.45.3; the audit reported no known vulnerabilities. Docker smoke passed 10/10 checks on rebuilt images. See [Phase 12 issues](phases/phase-12/Phase_12_Issues.md).

## Production readiness — 0.2.0 (post-Phase 12 hardening)

- Not a new phase; tracked in [Production readiness plan](PRODUCTION_READINESS_PLAN.md).
- 0.2.0 releases all 42 packages at one version, replacing the partial 0.1.0/0.1.1 publishes
  (root cause in [Releasing](RELEASING.md#what-happened-with-010-and-011)); earlier versions
  are deprecated. The release workflow now fails on any partial publish.
- Fixes: a timed-out tool call now aborts the tool's signal; the CLI and `create` scaffold
  apps against the released SDK version.
- 0.2.1 (2026-09-29): projects generated by the CLI and `create` install with npm 10, which
  Node 22 ships with; CI now runs the consumer projects with npm 10 and npm 11.
- 0.2.2 (2026-09-29): generated node and enterprise projects also work with yarn 1. Install
  matrix verified from npm: npm 10/11, pnpm, yarn 1, Node 22/24.
- Stability levels are recorded in [Versioning](VERSIONING.md#stability-levels). A
  Redis-backed run registry was declined for 0.2.0; multi-instance deployments require
  session affinity ([Scaling](production/SCALING.md)).

## Developer Studio enhancement (post-Phase 12, complete)

- Not a new phase. Tracked in [Developer Studio plan](developer-studio/ENHANCEMENT_PLAN.md) and
  [status](developer-studio/ENHANCEMENT_STATUS.md); architecture rule in
  [ADR 0023](adr/0023-development-and-application-planes.md).
- Added `@gixcopilot/studio` (Experimental, released with 0.2.3): the `/__gix` Studio and
  development API, read-only discovery, nine proposal-only generators, preview/diff, selective
  approval, an apply engine with conflict detection, secret scan, post-apply validation and
  rollback, lifecycle diagnostics, a live preview built from the real `@gixcopilot/ui`, and
  `attachStudio(copilot)` for `createCopilot`. Example: `examples/studio`.
- Verified: `pnpm validate` 71/71 projects, Playwright 23/23, 43/43 packages pack cleanly.

## Current Validation (Phase 11 completion)

Before any Phase 11 change: 41/41 projects, 1,154 tests passed, 4 skipped. Final tree:
**47/47 projects pass lint, typecheck, test and build; 1,251 tests passed, 29 skipped, 0 failed**.
The skips are the Docker-gated Testcontainers suites (Docker was not running; their code is
unchanged since they passed in Phase 10) and optional OpenAI smoke tests with no key.
Playwright: 8/8 passed. Live OpenAI eval (gpt-4o-mini, 15 cases x 2): the first run scored 13/15
(too-literal expectation and weak test embeddings in live mode; both fixed); later runs scored
15/15. Every live run had zero security violations. See
[Phase 11 Testing](phases/phase-11/Phase_11_Testing.md).

## Current Validation (Phase 10 completion)

Fresh `pnpm nx run-many -t lint,typecheck,test,build --skip-nx-cache` passed across all 39
lint/typecheck projects and all 38 buildable/testable projects. **1080 Vitest tests passed,
29 skipped** (checkpoint-postgres/jobs/vectorstore-pgvector Docker-gated integration suites,
unreachable in this environment for this specific pass; three pre-existing optional
real-OpenAI smoke tests without credentials), **zero failures**, across every project
including every Phase 1–9 test, unmodified. `@gixcopilot/jobs` and
`@gixcopilot/checkpoint-postgres`'s real-infrastructure suites (14 tests total) were run for
real against genuine Redis/Postgres Testcontainers earlier in this same session and **passed
for real**, before Docker became unreachable in this environment for the final pass —
disclosed explicitly rather than assumed still-passing; see
[Phase 10 Testing](phases/phase-10/Phase_10_Testing.md) for exact commands and results. All
three examples' `demo` scripts were built and actually run against the deterministic mock
provider this session, including direct confirmation of genuine concurrent parallel
delegation in `multi-agent`'s event log and a real pause/approve/resume state mutation in
`workflow-approval`. No example was exercised against a real OpenAI model this session
(`OPENAI_API_KEY` unavailable in this environment) — disclosed explicitly, not assumed. The
Chromium/Playwright browser suite was not re-run this session (no Phase 10 browser UI was
added to it; its lint/typecheck targets were re-run and pass).

## Phase 10 prompt-completeness audit (2026-09-25)

An audit of `docs/prompts/Phase_10_Prompt.md` against the repository closed the remaining
gaps: `examples/multi-agent` gained a real-OpenAI mode and its `payments.get` now takes the
caller from trusted context instead of a model-supplied user id (a real run had the model
invent one); `examples/workflow-compensation` was added (Section 175); latency was measured
(Section 213); an intermittent unhandled rejection in `@gixcopilot/jobs`' `close()` was
fixed; `CHANGELOG_PHASES.md`/`TECHNICAL_DEBT.md` gained their missing Phase 10 entries; and the
truncated prompt file was repaired. **All three model-using examples passed against real
OpenAI (`gpt-4o-mini`).** Fresh `nx run-many -t lint,typecheck,test,build --skip-nx-cache`:
41/41 projects pass, **1154 tests passed, 4 skipped (optional OpenAI smoke tests), 0
failed**, with Docker available so the Redis/Postgres Testcontainers suites ran for real.
This ran on a working tree that also contains in-progress Phase 11 changes. See
[Phase 10 Testing](phases/phase-10/Phase_10_Testing.md).

## Current Validation (Phase 9 completion)

Fresh `pnpm nx run-many -t lint,typecheck,test,build --skip-nx-cache` passed across all 32
lint/typecheck/buildable/testable projects. **996 Vitest tests passed, 4 optional real-provider
smoke tests skipped** without credentials/opt-in, zero failures, across every project including
every Phase 1–8 test, unmodified apart from the additive protocol error codes above. The
real-provider flow (real OpenAI embeddings + chat, real pgvector) was then run explicitly this
session against a genuine OpenAI API key and a disposable, migrated PostgreSQL container, and
**passed for real** — the cited answer, the viewer/admin authorization boundary, the
Arabic-instruction-overrides-English-memory precedence case, and explicit memory deletion all
verified against live infrastructure, not prompt-matched; see
[Phase 9 Testing](phases/phase-09/Phase_9_Testing.md) for exact commands, durations, and the raw
measurements. The Chromium/Playwright browser suite was not re-run this session (no Phase 9
browser UI was added to it; its lint/typecheck targets were re-run and pass).

## Current Validation (Phase 8 completion)

Fresh `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (via `nx run-many
--skip-nx-cache`) passed across all 27 lint/typecheck projects and all 26 buildable/testable
projects — **750 Vitest tests passed, 4 optional real-OpenAI smoke tests skipped** without
credentials/opt-in (`examples/model-streaming`, `examples/openapi` ×2, `examples/mcp`; a
fifth optional suite, `examples/react-generative-ui`'s, also skipped in this particular run
since `OPENAI_API_KEY` was not in the shell's ambient environment), zero failures, across 105
test files — including every Phase 1–7 test, unmodified except the `toToolNameSegment`
relocation (both `@gixcopilot/generative-ui` import sites updated, its suite re-run and
passing). All four skipped Phase 8 real-OpenAI tests were then run explicitly, with
`OPENAI_API_KEY` supplied via `--env-file` and `RUN_OPENAI_SMOKE=1`, and **all passed for
real** — the model chose and called `vas.getApplication` (a generated OpenAPI GET tool), the
model chose `vas.assignApplication` (a generated OpenAPI POST tool) and the mutation
genuinely waited for supervisor approval before reaching the local HTTP API, and the model
chose and called `mcp.widgets.getWidget` over a real, separately-spawned MCP server process —
disclosed explicitly, not assumed; see [Phase 8 Testing](phases/phase-08/Phase_8_Testing.md)
for exact commands and durations. The Chromium/Playwright browser suite was not re-run this
session (no Phase 8 UI surface exists to add to it; its lint/typecheck targets were re-run and
pass).

## Current Validation (Phase 7 completion)

Fresh `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passed across all 22
lint/typecheck projects and all 21 buildable/testable projects. **351 Vitest tests passed, 1
pre-existing optional OpenAI smoke test skipped** without credentials, zero failures —
including every Phase 1–6 test (one pre-existing Phase 5 assertion updated to match a
disclosed, deliberate behavior improvement — see
[Phase 7 Issues](phases/phase-07/Phase_7_Issues.md)). `examples/react-enterprise`'s security/
HITL pipeline was additionally verified manually, live, over real HTTP this session (not only
via automated tests) — see [Phase 7 Testing](phases/phase-07/Phase_7_Testing.md). No
`OPENAI_API_KEY` was available for that example in this session, so its own optional real-model
chat path was **not** exercised against a live model — disclosed explicitly, not assumed. The
Chromium/Playwright browser suite was not re-run this session (no Phase 7 UI surface was added
to it; its lint/typecheck targets were re-run and pass).

## Current Validation (Phase 6 completion)

Fresh `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passed across all 20
lint/typecheck projects and all 19 buildable/testable projects. **407 Vitest tests passed, 1
existing optional OpenAI smoke test skipped** without credentials, zero failures — including
every Phase 1–5 test, unmodified. The Chromium/Playwright browser suite was not re-run this
session (no Phase 6 UI surface was added to it; its lint/typecheck targets were re-run and
pass); see [Phase 6 Testing](phases/phase-06/Phase_6_Testing.md) and
[Phase 6 Issues](phases/phase-06/Phase_6_Issues.md) (two real bugs found and fixed during
implementation: a tool-name sanitization crash and a render-error-isolation gap).

## Validation (historical Phase 5 completion)

Fresh `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passed across all 18
lint/typecheck projects and all 17 buildable/testable projects. **350 Vitest tests passed, 1
existing optional OpenAI smoke test skipped** without credentials, zero failures — including
every Phase 1–4 test (with a disclosed, mechanical, behavior-preserving narrowing fix at five
call sites required by the additive `ContentPart` union — see
[Phase 5 Issues](phases/phase-05/Phase_5_Issues.md)). The Chromium/Playwright browser suite
was not re-run this session (no Phase 5 UI surface was added to it; its lint/typecheck
targets were re-run and pass); see [Phase 5 Testing](phases/phase-05/Phase_5_Testing.md).

## Validation (historical Phase 4 completion)

Fresh `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passed across all 16
lint/typecheck projects and all 15 buildable/testable projects. **228 Vitest tests passed, 1
existing optional OpenAI smoke test skipped** without credentials, zero failures — including
every Phase 1–3 test, unmodified. The Chromium/Playwright browser suite was not re-run this
session (a pre-existing local process already held the port it needs); see
[Phase 4 Testing](phases/phase-04/Phase_4_Testing.md) and
[Phase 4 Issues](phases/phase-04/Phase_4_Issues.md).

## Validation (historical Phase 3 completion)

Fresh `nx run-many -t lint,typecheck,test,build --skip-nx-cache` passed the available targets
across all 14 projects. **159 tests passed, 1 existing optional OpenAI smoke test skipped**
without credentials. **6 Chromium E2E tests passed**, including mobile RTL/dark mode,
keyboard/focus, streaming/stop/retry, headless UI and long-response scrolling. Node-only SSR,
dependency-boundary rejection probes and package tarball inspection also passed. See the
[completion report](phases/phase-03/Phase_3_Status.md) and
[testing evidence](phases/phase-03/Phase_3_Testing.md).

## Validation (historical Phase 2 completion)

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass across all 9 buildable
projects (`protocol`, `core`, `client`, `server`, `provider`, `provider-mock`,
`provider-openai`, `protocol-demo`, `model-streaming-demo`). See
`docs/phases/phase-02/Phase_2_Testing.md` for the full results and exact commands run.
