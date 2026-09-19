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
   deployment cannot route a cancel request to whichever instance holds the run. No action
   needed until a phase actually requires horizontal scaling of the server.
   _(Since: Phase 1)_

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
