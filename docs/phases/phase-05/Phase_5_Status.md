# AI Copilot SDK — Phase 05: Tools & Agent Actions

Status: **COMPLETE**.

## Implementation and acceptance

- [x] `@gixcopilot/tools`: new, framework-independent, depends only on `@gixcopilot/protocol`
      (+ `zod`) — no React, no Fastify, no provider SDK.
- [x] Canonical `ToolDefinition`: typed input/output (Zod), runtime input/output validation,
      description, extensible metadata, stable dot-namespaced identity, `enabled`.
- [x] `defineTool()`: full input/output type inference, no repeated annotations.
- [x] `ToolRegistry`: register/unregister/get/list/subscribe/clear; duplicate names rejected
      by default (`{ replace: true }` opts in, documented decision); multiple independent
      registry instances supported (no global singleton).
- [x] `ToolResolver` discovery boundary: `createDefaultToolResolver`, `createStaticToolResolver`,
      `combineToolResolvers` — `registry.list()` is never wired directly into a model request
      anywhere in the codebase.
- [x] `ToolRuntime`: resolve → validate input → middleware → timeout/cancellation → execute →
      validate output → serialize/bound → normalize `ToolResult`; never throws.
- [x] Tool lifecycle (`requested → started → completed | failed`, with `CANCELLED`/`TIMEOUT`
      as `failed` error codes) with events forwarded to the wire as `tool.*` `CopilotEvent`s.
- [x] Tool timeout (per-tool `metadata.timeoutMs` or a runtime default) and cancellation
      (propagates the run's own `AbortSignal`) — verified never to emit a stray
      `tool.completed` after cancellation.
- [x] Parallel tool execution: `runWithConcurrencyPlan` runs a batch fully parallel unless any
      call declares `serial`/`exclusive` metadata, in which case the whole batch runs
      sequentially; results always correlate back to the correct `toolCallId`.
- [x] Provider-neutral tool calling: `ModelRequest.tools`, `ModelStreamEvent.tool_call.requested`,
      `ToolCallAssembler` for fragmented streamed arguments — no OpenAI SDK type reaches
      `@gixcopilot/core` or `@gixcopilot/tools`.
- [x] Mock provider scripted tool calls (`MockProviderScenario.toolCalls`) and a real OpenAI
      adapter mapping (tools param, streamed `tool_calls` assembly, `tool`-role message
      mapping) — unit-tested with a fake OpenAI-shaped client, no live API key required.
- [x] Model → Tool → Model loop (`createToolCallingExecutor`), implemented as a single
      `Executor`, with a configurable `maxToolIterations` (default 8) that throws
      `TOOL_ITERATION_LIMIT_EXCEEDED` rather than looping forever.
- [x] Structured outputs: `generateObject()`, distinct from tool output, built on the same
      `ModelRuntime.stream()` path; invalid JSON or schema mismatch is a validation error, not
      a best-effort partial object.
- [x] Frontend tools: `useFrontendTool()` (StrictMode-safe register/dispose, current-closure
      execution per Section 48), a per-`CopilotProvider` frontend `ToolRegistry`/`ToolRuntime`,
      a wire-safe `ToolManifestEntry[]` sent with every run, and a real
      `POST /runs/:runId/tool-results` round trip via `FrontendToolBridge`
      (cancellation-aware, and a configurable `frontendToolTimeoutMs` so a disconnected/
      unresponsive client can never hang a run).
- [x] Generic tool activity UI: `useToolCalls()` headless hook + `@gixcopilot/ui`'s
      `ToolActivity` component (overridable slot), never rendering raw arguments/results by
      default.
- [x] `examples/react-tools`: demonstrates backend tool, frontend tool, context + tool, tool
      error, and tool cancellation, end to end, against a real server/client, using a
      deterministic non-network provider (no AI key required).
- [x] 350 tests passing across the whole workspace (1 pre-existing OpenAI smoke test skipped,
      no credentials configured — unchanged), including a real fix to a genuine concurrency
      bug found during Phase 5's own integration testing (see [Testing](Phase_5_Testing.md)).
- [x] All ten Phase 5 documents, package README, global docs, and a new ADR populated.
- [x] No Generative UI, dynamic model-generated React/JS execution, Action Firewall, HITL/
      approval workflow, OpenAPI/MCP auto-tool-generation, RAG, agents, or DevTools UI.

## Validation report

Previous-phase regression gate: Phase 1 **PASS**, Phase 2 **PASS**, Phase 3 **PASS**, Phase 4
**PASS** — every pre-existing test in the workspace (228 at the end of Phase 4) passed
unmodified except where a type change (`ContentPart`'s additive union) required a
`.filter(part => part.type === 'text')` narrowing helper in a handful of pre-existing
`.content.map(part => part.text)` call sites (`@gixcopilot/ui`, `@gixcopilot/react`,
`examples/react-custom-ui`) — a mechanical, behavior-preserving fix required by TypeScript's
stricter narrowing once `ContentPart` gained non-text variants, not a logic change. See
[Testing](Phase_5_Testing.md) for the itemized list.

Final fresh full-workspace validation:

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

**PASS** across all 18 lint/typecheck projects and all 17 test/build projects. **350 Vitest
tests passed, 1 pre-existing optional OpenAI smoke test skipped**, **zero failures**. See
[Testing](Phase_5_Testing.md) for the full per-project breakdown and exact commands.

The Chromium/Playwright browser suite (`react-e2e`) was **not re-run** this session — it has
no Phase 5-specific coverage and was out of scope for this phase's changes; its lint/typecheck
targets were re-run and pass. This is disclosed, not silently omitted.

## Architecture and review

Framework independence (`@gixcopilot/tools` has zero React/Fastify/provider-SDK dependency),
provider-neutral tool calling (no OpenAI SDK type reaches core/tools), the frontend/backend
canonical tool model, zero-trust argument validation on both client and server, and backward
compatibility (every Phase 1–4 public API and behavior unchanged except the disclosed
mechanical `ContentPart` narrowing fix) were checked against source and tests — see
[Architecture](Phase_5_Architecture.md) and [Decisions](Phase_5_Decisions.md). Public APIs are
in [API](Phase_5_API.md); the complete file inventory is in [Files](Phase_5_Files.md); known
limits are in [Issues](Phase_5_Issues.md).

Remaining Phase 5 work: **None.** Source, exports, dependency graph, and the working-tree
diff were reviewed against this phase's acceptance checklist before this report.

Next phase: **Phase 06 — Generative UI & Shared State: LOCKED / NOT STARTED.** Waiting for
explicit user authorization; no Phase 6 code, config, or scaffolding was introduced.

## Addendum (non-phase task, later session)

The "Use Real OpenAI Model in Example Application" task (not a new phase — see
[docs/guides/REAL_OPENAI_EXAMPLE.md](../../guides/REAL_OPENAI_EXAMPLE.md)) exercised this
phase's frontend/backend tool-calling pipeline against a real OpenAI model in
`examples/react-generative-ui`, including a real tool-calling round trip
(`applications.getStatus`) in an optional, key-gated smoke test. No changes were needed in
`@gixcopilot/tools` or the Tool Runtime. This is a validation note, not a revision of the
findings above.
