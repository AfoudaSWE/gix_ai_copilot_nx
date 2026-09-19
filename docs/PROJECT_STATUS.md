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
Phase 04 - Application Context & State         NOT STARTED / LOCKED
Phase 05 - Tools & Agent Actions               NOT STARTED / LOCKED
Phase 06 - Generative UI & Shared State        NOT STARTED / LOCKED
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
- Phase 4 remains **LOCKED / NOT STARTED**.

## Current Validation (Phase 3 completion)

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
