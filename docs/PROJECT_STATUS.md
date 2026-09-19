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
Phase 07 - Enterprise Security & HITL          NOT STARTED / LOCKED
Phase 08 - OpenAPI + MCP + Integrations        NOT STARTED / LOCKED
Phase 09 - Knowledge + RAG + Memory            NOT STARTED / LOCKED
Phase 10 - Agents + Multi-Agent + Workflows    NOT STARTED / LOCKED
Phase 11 - DevTools + Testing + Evals + Obs.   NOT STARTED / LOCKED
Phase 12 - Production Platform + Ecosystem     NOT STARTED / LOCKED
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
- Phase 7 remains **LOCKED / NOT STARTED**.

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
