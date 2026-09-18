# Phase 1 Handoff

Written retroactively, with the benefit of Phase 2 now also being complete — this records
what Phase 1 actually left for Phase 2 to build on, and, in hindsight, how accurate that
preparation turned out to be.

## What Existed at Phase 1 Completion

- A real, working, tested protocol/core/server/client stack proving
  `Client -> HTTP -> Server -> Core -> SSE -> Client`, entirely without any AI dependency.
- A deliberately generic `Executor` boundary in `@gixcopilot/core`, designed specifically
  so a real model integration could attach to it later without changing core itself.
- A protocol (`CopilotEvent`) designed for forward-compatible extension: unknown event
  types are safely ignorable, and adding an optional field to an existing event
  (`RunCompletedEvent`, say) was always meant to be non-breaking.

## What Phase 2 Actually Relied On

In hindsight, Phase 2 (`@gixcopilot/provider`, `@gixcopilot/provider-mock`,
`@gixcopilot/provider-openai`) used exactly the seam Phase 1 built for it:

- `createModelExecutor` implements `@gixcopilot/core`'s `Executor` interface directly — no
  change to `Executor`'s core shape was needed, only an additive extension to what it can
  _return_ (`ExecutorCompletion`, carrying `usage`/`finishReason`) once it finishes.
- `RunCompletedEvent.finishReason` was added as a genuinely optional field, exactly as the
  protocol's design intended — a Phase 1 client parsing a Phase 2 event never needed to
  change.
- `@gixcopilot/server`'s `createServer({ runtime })` became `createServer({ runtime,
modelRuntime? })` — additive, not a rewrite.

## What Did Need to Change (and why that was fine)

- `RunOptions.message` (singular) became `RunOptions.messages` (an array), across core,
  server, and client. This was **not** anticipated or prepared for in Phase 1 — Phase 1
  had no multi-turn conversation concept at all, since the deterministic echo executor
  never needed one. This was a real, acknowledged breaking change, accepted because
  nothing was published/versioned yet (see
  `docs/adr/0006-model-provider-abstraction.md`'s "Consequences" section).

## Known Limitations Phase 2 Inherited As-Is

- The server's run registry is in-memory and process-local (documented in Phase 1,
  unchanged by Phase 2 — model-backed runs use the exact same registry).
- IDs remained plain `string` aliases, not nominally-branded types.
- The disconnect-detection fix (`Phase_1_Issues.md`) was re-verified, not re-broken, by
  Phase 2's changes — the model-backed run path reuses the same `POST /runs` handler and
  the same fix.

## Do Not (as stated at the time, now historical)

Per the phase-gate skill, Phase 1's own handoff explicitly said not to start Phase 2 (LLM
Runtime & Streaming) until asked. That instruction was honored — Phase 2 began only on an
explicit, later request.
