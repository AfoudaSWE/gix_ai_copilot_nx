# Phase Changelog

| Phase                          | Delivered                                                                                                                                | Record                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 01 — Foundation & Architecture | Protocol, generic core, HTTP/SSE server/client, deterministic echo integration                                                           | [Phase 1](phases/phase-01/Phase_1_Docs.md) |
| 02 — LLM Runtime & Streaming   | Provider-neutral model runtime, registry, mock/OpenAI adapters, retry/timeout/cancellation                                               | [Phase 2](phases/phase-02/Phase_2_Docs.md) |
| 03 — React Copilot UI          | Headless React provider/hooks and optional chat/popup/sidebar UI, safe Markdown, themes/RTL/accessibility, examples and browser coverage | [Phase 3](phases/phase-03/Phase_3_Docs.md) |
| 04 — Application Context & State | Framework-independent `@gixcopilot/context` engine (scopes, priority, sensitivity, serialization, dedup, token budgeting/truncation), shared typed state store, `useCopilotContext`/`useCopilotState` React hooks, resolved context injected into model requests, application-aware chat example | [Phase 4](phases/phase-04/Phase_4_Docs.md) |
| 05 — Tools & Agent Actions | Framework-independent `@gixcopilot/tools` (canonical `ToolDefinition`/`defineTool`, registry, resolver, execution runtime), provider-neutral tool calling and a real Model → Tool → Model loop, backend + frontend tools sharing one model, `useFrontendTool`/`useToolCalls`, generic tool activity UI, structured outputs (`generateObject`), tools example covering backend/frontend/context+tool/error/cancellation | [Phase 5](phases/phase-05/Phase_5_Docs.md) |
| 06 — Generative UI & Shared State | Framework-independent `@gixcopilot/generative-ui` (trusted component registry, reserved-tool bridge for model-selected components, state-patch tool bridge, progress mapping), structured UI requests carried over the canonical Phase 5 tool-calling pipeline with zero protocol/core/server changes, custom tool-result renderers (`useToolRenderer`), direct interactive tool invocation (`useInvokeTool`), AI-writable shared state with revision/conflict handling (`useCopilotState({ modelWritable })`), generative-UI example covering component rendering, interactive actions, and state conflicts | [Phase 6](phases/phase-06/Phase_6_Docs.md) |
| 07 — Enterprise Security & HITL | Framework-independent `@gixcopilot/security` (AI Action Firewall, RBAC + ABAC policy engine, five-level HITL approval state machine, dry-run/preview, PII redaction, rate limiting, audit trail), enforced in `@gixcopilot/server`'s tool-calling dispatch step for backend/frontend/direct-invoked actions alike, `ApprovalCard`/`SecurityDenial` UI, enterprise example spanning every risk/approval tier verified live over real HTTP | [Phase 7](phases/phase-07/Phase_7_Docs.md) |
| 08 — OpenAPI + MCP + Integrations | `@gixcopilot/openapi` (spec -> canonical tool generation with conservative exposure defaults, an SSRF-safe HTTP executor, and no second approval mechanism), `@gixcopilot/mcp` (official SDK wrapped behind project-owned types, deny-by-default exposure), `@gixcopilot/integrations` (uniform integration registry); `jsonSchemaToZod`/`toToolNameSegment`/`CredentialProvider` promoted into `@gixcopilot/tools` as shared primitives; `examples/openapi` and `examples/mcp` prove the full Model -> Generated Tool -> real execution chain end to end | [Phase 8](phases/phase-08/Phase_8_Docs.md) |
| 09 — Knowledge + RAG + Memory | `@gixcopilot/knowledge` (source/document/loader contracts: text/markdown/PDF/DOCX/HTML/web/API/database/object-storage/MCP-resource, SSRF-guarded web loading), `@gixcopilot/rag` (chunking, embeddings, storage-agnostic `VectorStore`, permission-aware retrieval with SQL + application ACL/tenant filtering, reranking, citations, Context Engine integration), `@gixcopilot/vectorstore-pgvector` (PostgreSQL + pgvector adapter, SQL-level ACL enforcement, atomic reindex), `@gixcopilot/memory` (working/session/durable/semantic memory, owner+tenant security, credential write-policy, explicit-consent persistence service); `useCitations`/`<Citation />`/`<CitationList />`/`<SourcePreview />` added with no react/ui -> rag/memory dependency; `examples/react-rag` proves permission-aware RAG, memory precedence, MCP-resource ingestion and prompt-injection containment end to end, verified against real OpenAI + real pgvector | [Phase 9](phases/phase-09/Phase_9_Docs.md) |
| 10 — Agents + Multi-Agent + Workflows | `@gixcopilot/agents` (`defineAgent`, registry, runtime with iteration/tool/delegation/depth/timeout limits and cancellation, deterministic + model routing, delegation and handoff with least-privilege tool/knowledge/memory intersection, same-turn parallel specialists with fail-fast/collect-results, planner/executor with plan validation, OpenTelemetry spans), `@gixcopilot/workflows` (function/tool/agent/approval/condition/parallel steps, DAG validation, checkpoints, version-checked idempotent resume, re-authorization on resume, retry, compensation, tenant isolation, Phase 7 approvals reused), `@gixcopilot/checkpoint-postgres` (Drizzle/Postgres checkpoint store with optimistic concurrency), `@gixcopilot/jobs` (BullMQ executor + dead-letter behind a `JobExecutor` port; inline default); agent/workflow progress hooks in `@gixcopilot/react`; `agent-basic`, `multi-agent`, `workflow-approval` examples verified against real OpenAI, plus a deterministic `workflow-compensation` example | [Phase 10](phases/phase-10/Phase_10_Docs.md) |
| 11 — DevTools + Testing + Evals + Observability | `@gixcopilot/telemetry` (TelemetryAdapter port with no-op/OpenTelemetry/recording adapters, semantic conventions, internal diagnostics channel, safe redaction, sampling, metrics, cost estimation, instrumentation for every runtime seam), `@gixcopilot/devtools` (read-only viewer-scoped inspectors, debug bundles, opt-in authenticated read-only transport), `apps/devtools` (accessible React DevTools UI), `@gixcopilot/testing` (test models, tool mocks, security/RAG/memory/approval fixtures, agent and workflow simulation, side-effect-free replay), `@gixcopilot/evals` (datasets, 24 evaluators, reports, baseline comparison, experiments, CI gates with security hard gates); `examples/devtools` and `examples/evals`, the latter verified against real OpenAI | [Phase 11](phases/phase-11/Phase_11_Docs.md) |
| 12 — Production Platform + Ecosystem | Angular and Node SDKs, shared headless state, CLI starters, PostgreSQL/Redis workers, tenant and usage policy, model routing, management API/platform, deployment and internal release candidate tooling, docs portal. Historical example credential rotation and exposure review confirmed by the owner. | [Phase 12](phases/phase-12/Phase_12_Docs.md) |

The authoritative completion state is [PROJECT_STATUS.md](PROJECT_STATUS.md).
This file records phases, not npm releases.

## Phase 11 completion review

Completed the telemetry layer (sampling, structured logs, browser-safe ids) and fixed two
redaction bugs that blanked token counts and retrieval ACL counts. Built DevTools core and UI,
the testing SDK and the evaluation framework, with two examples. Tests and a real browser run
found and fixed DevTools projection bugs: resumed approval steps, firewall-blocked calls,
cross-run tool-call id joins, and an O(runs x events) projection (588 ms to 6 ms on 23,000
events). A live OpenAI eval passed 15/15 with zero security violations, after the first live run
(13/15) exposed a too-literal expectation and weak test embeddings in live mode.

## Phase 10 completion review

Fixed a broken `pnpm-workspace.yaml` placeholder that hard-failed `pnpm install`. Closed gaps
in the prior draft: knowledge/memory narrowing on delegation was declared but never enforced,
parallel specialist dispatch did not exist, `@gixcopilot/jobs` had no tests, and there was no
OpenTelemetry instrumentation, React progress hooks, examples, or phase documents. A prompt
audit then added a real-model mode to `multi-agent`, fixed its payment tool to take the
caller from trusted context rather than model arguments (found by a real OpenAI run), recorded
performance measurements, added the missing compensation example, fixed an intermittent
unhandled rejection in the BullMQ executor's `close()`, and repaired the truncated Phase 10
prompt file. All three examples
pass against real OpenAI.

## Phase 9 completion review

Fixed a broken `pnpm-workspace.yaml` scaffold that hard-failed `pnpm install`. Built
`@gixcopilot/memory` from scratch (it was empty scaffolding). Found and fixed a real SQL
operator-precedence bug in pgvector's threshold search, caught by a genuine Testcontainers
integration run. Added citation UI, the `react-rag` example, and all ten Phase 9 documents plus
ADR 0014. Real OpenAI + real pgvector smoke run passed, including the mandatory viewer/admin
critical security test and the current-instruction-wins memory precedence case. No Phase 10
work started.

## Phase 8 completion review

Completed missing phase documents and package READMEs. Hardened explicit exposure, credential headers/echo redaction, URL/redirect safety, schema constraints and response validation, normalized errors, bounded reads/retries, refresh/disposal and MCP lifecycle. Wired both examples through the Phase 7 firewall/approval path; added mixed-source governance, cancellation and lifecycle regressions. Added source-aware audit, telemetry and a measured 1,000-operation benchmark. Real OpenAI read, approved write and MCP smoke tests passed against local test infrastructure. No Phase 9 work started.
