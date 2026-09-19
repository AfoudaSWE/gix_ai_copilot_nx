# Phase 5 Testing — Executed Checks and Evidence

All commands below were actually executed this session (not assumed) via `pnpm` at the
workspace root, on Windows/Git Bash, Node 22, pnpm 11, Nx 21. Per-project figures are copied
directly from the Vitest/tsc/ESLint output.

## Final full-workspace validation

```sh
pnpm lint       # 18/18 projects PASS
pnpm typecheck  # 18/18 projects PASS
pnpm test       # 17/17 test-bearing projects PASS, 350 passed / 1 skipped / 0 failed
pnpm build      # 17/17 buildable projects PASS
```

(`react-e2e` has a lint/typecheck target but no Vitest/build target — it is the separate
Playwright suite, not re-run this session; see [Status](Phase_5_Status.md).)

## Per-project test counts (this session's run)

| Project | Files | Tests | Notes |
| --- | ---: | ---: | --- |
| `@gixcopilot/protocol` | 5 | 31 | +1 file (`tool.spec.ts`, 7 tests), +2 tests in `errors.spec.ts`, +6 in `serialization.spec.ts` |
| `@gixcopilot/tools` | 8 | 48 | entirely new package |
| `@gixcopilot/core` | 5 | 33 | +3 tests in `runtime.spec.ts` (tool-event draining, cancellation-safety, empty-delta suppression) |
| `@gixcopilot/provider` | 6 | 42 | +2 new files (`tool-call-assembler.spec.ts` 7, `generate-object.spec.ts` 4), +1 test in `model-executor.spec.ts`, +2 in `model-runtime.spec.ts` |
| `@gixcopilot/provider-mock` | 1 | 13 | +4 tests (scripted tool calls) |
| `@gixcopilot/provider-openai` | 2 | 18 | +1 new file (`message-mapping.spec.ts`, 6 tests), +3 tests in `openai-provider.spec.ts` |
| `@gixcopilot/client` | 3 | 19 | +5 tests (tools passthrough, `submitToolResult`) |
| `@gixcopilot/context` | 6 | 50 | unchanged — not modified this phase |
| `@gixcopilot/react` | 5 | 27 | +1 new file (`frontend-tool-hooks.spec.tsx`, 4 tests) |
| `@gixcopilot/server` | 6 | 31 | +3 new files (`frontend-tool-bridge.spec.ts` 7, `tool-calling-executor.spec.ts` 4, `tool-frontend.e2e.spec.ts` 3), +4 tests in `app.spec.ts` |
| `@gixcopilot/ui` | 2 | 19 | +1 new file (`tool-activity.spec.tsx`, 2 tests) |
| `examples/react-basic` | 1 | 3 | unchanged |
| `examples/react-custom-ui` | 1 | 1 | unchanged (source fixed for the `ContentPart` narrowing, behavior identical) |
| `examples/react-context` | 1 | 3 | unchanged |
| `examples/model-streaming` | 2 | 3 (+1 skipped) | unchanged; skipped test is the OpenAI smoke test (no `OPENAI_API_KEY`) |
| `examples/protocol-demo` | 1 | 4 | unchanged |
| `examples/react-tools` | 1 | 5 | new example — see below |
| **Total** | | **350 passed, 1 skipped, 0 failed** | |

## Required end-to-end tests (explicitly mandated by the phase brief)

- **Backend E2E** (Section 81, 101) — `packages/server/src/app.spec.ts`, "runs the full
  Model -> Tool -> Model loop for a registered backend tool and streams tool.* events":
  real Fastify server (via `app.inject()`), a real `@gixcopilot/tools` registry/runtime, a
  deterministic fake `ModelProvider` — asserts the exact event sequence `run.started →
  message.started → tool.requested → tool.started → tool.completed → message.delta →
  message.end → run.completed`, with `tool.requested.source === 'native'` and the correct
  tool result. **PASS**.
- **Frontend E2E** (Section 82, 102) — `packages/server/src/tool-frontend.e2e.spec.ts`,
  "completes the full Model -> Server -> Client -> Server -> Model round trip": a **real
  listening HTTP server** (`app.listen()`) and **real `fetch`** (not `app.inject()`, which
  buffers the whole response and cannot exercise a concurrent second request) — the test
  reads the SSE stream incrementally, and upon seeing `tool.requested` with
  `source: 'frontend'`, fires a second, concurrent `POST /runs/:runId/tool-results` against
  the same real server while the first request is still streaming. **PASS**. Also covers:
  `FRONTEND_TOOL_UNAVAILABLE` on timeout (Section 51) and clean bridge cleanup on client
  disconnect (no server hang) — both **PASS**.
- **Context + Tool** (Section 57, 83) — `examples/react-tools/src/integration.spec.tsx`,
  "resolves 'its status' using the currently selected application as context": real
  `useCopilotContext` → context engine → the demo provider reads the resolved context text
  to decide which tool call to make. **PASS**.
- **Cancellation** (Section 85) — both `packages/core/src/runtime.spec.ts` (unit-level: "never
  emits a tool.completed after cancellation") and `examples/react-tools/src/integration.spec.tsx`
  ("stopping the run during a slow tool call ends it cleanly with no completion afterward" —
  a real ~2s tool, a real Stop click, a real 2.2s wait confirming no late completion text ever
  arrives). **PASS**.
- **Parallel execution** — `packages/tools/src/concurrency.spec.ts` (a parallel-safe batch
  measurably runs concurrently in wall-clock order vs. a forced-sequential batch) and
  `packages/tools/src/tool-runtime.spec.ts`'s middleware-ordering test. **PASS**.
- **Tool error** (Section 84) — `packages/tools/src/tool-runtime.spec.ts` ("never executes the
  tool body when arguments fail schema validation", "rejects output that fails the declared
  output schema", "normalizes a thrown error…") and `examples/react-tools/src/
  integration.spec.tsx` ("surfaces a failed tool call back to the model, which explains the
  failure instead of crashing"). **PASS**.

## A real bug found and fixed during this phase's own testing

While writing the backend E2E test above, an event sequence came back as
`['run.started', 'message.started', 'run.failed']` with **no** `tool.requested` events at
all, instead of the expected `TOOL_NOT_FOUND` handling. Root cause: `@gixcopilot/core`'s
`runtime.ts` only drained its `pendingToolEvents` queue *after a successful*
`deltaIterator.next()` resolution — if the wrapped executor's async generator **rejects**
(throws) instead of yielding/returning normally, the drain step was never reached and every
queued tool event was silently lost. This surfaced because a scripted test provider that
kept requesting an unresolvable tool name pushed the loop to its `maxToolIterations` limit
with no intervening text yields, so eight rounds' worth of `tool.requested` notifications
queued up and were dropped the instant `TOOL_ITERATION_LIMIT_EXCEEDED` was thrown. **Fixed**
by also draining the queue in `runtime.ts`'s `catch` block, before emitting `run.cancelled`/
`run.failed`. A regression test (`runtime.spec.ts`, "drains pending tool events queued just
before the executor throws") pins this down. This is exactly the kind of bug integration
testing across real package boundaries is meant to catch — see the testing skill's rule
against claiming a check "should work" without actually running it.

A second, related issue was found in the same pass: a frontend tool's `tool.requested` event
was queued but never flushed before the executor's next step blocked on
`frontendToolBridge.awaitResult()` — since nothing yields between queuing the event and that
await, the client could never receive the event it needed to respond to, deadlocking the
whole round trip. **Fixed** by having the tool-calling executor `yield ''` (a no-op text
delta) immediately after announcing every call's `requested` phase, forcing a drain before
any blocking dispatch begins; `runtime.ts` was further changed to suppress an empty delta
entirely rather than emit a no-op `message.delta`, keeping this purely an internal detail.
Verified by `packages/server/src/tool-frontend.e2e.spec.ts`'s real-network round-trip test,
which hung (via a 5s Vitest test timeout) before the fix and passes in ~450 ms after it.

## Mechanical fixes required by the additive `ContentPart` change

Widening `ContentPart` from a single `{ type: 'text' }` variant to a discriminated union
(adding `tool_call`/`tool_result`) is a backward-compatible *protocol* change (existing text
messages are unaffected), but it does make `message.content.map(part => part.text)` a
TypeScript error anywhere it appeared un-narrowed, since `part.text` no longer exists on
every union member. Five pre-existing call sites needed a `.filter(part => part.type ===
'text')` narrowing helper added: `packages/ui/src/components.tsx` (`UserMessage`,
`AssistantMessage`, the completion announcement), `packages/react/src/chat-store.ts`
(`message.delta` aggregation), and `examples/react-custom-ui/src/app.tsx`. Each fix is
behavior-preserving (the old code implicitly only ever saw text parts, since no other
variant existed before Phase 5) and is covered by the pre-existing tests for those files,
all of which pass unmodified in outcome.

## Not run / explicitly deferred

- **Chromium/Playwright `react-e2e` suite** — not re-run; no Phase 5 UI surface was added to
  it. Its `lint`/`typecheck` targets were re-run and pass.
- **Live OpenAI smoke test** (`examples/model-streaming/src/openai-smoke.spec.ts`) — skipped,
  as in every prior phase, because `OPENAI_API_KEY` is not set in this environment; the
  OpenAI adapter's Phase 5 tool-calling logic is instead covered by
  `packages/providers/openai/src/openai-provider.spec.ts`'s fake-client tests (a synthetic
  OpenAI-shaped fragmented `tool_calls` stream), which do not require network access or a key.
