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

## Resolved

- ~~Server cancelled every run almost immediately due to listening for client-disconnect on
  the wrong stream (`request.raw` instead of `reply.raw`).~~ Fixed during Phase 1
  validation — see `docs/adr/0004-sse-as-initial-streaming-transport.md`.
- ~~The OpenAI SDK's own built-in retry logic was fighting with `ModelRuntime`'s retry
  policy, causing real, uncontrolled backoff delays.~~ Fixed during Phase 2 validation by
  setting `maxRetries: 0` on the OpenAI client — see
  `packages/providers/openai/src/openai-provider.ts`.
