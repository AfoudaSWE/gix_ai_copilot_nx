# Phase 2 Testing

All commands below were actually executed in this session; results are copied from their
real output, not assumed. Full clean run (`npx nx reset` first, so nothing is cached):

```sh
npx nx run-many -t lint,typecheck,test,build
```

Result: **`NX Successfully ran targets lint, typecheck, test, build for 9 projects`**

## Per-Project Test Counts (all passing)

| Project                | Test files | Tests                | Notes                                                                                                                                                         |
| ---------------------- | ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protocol`             | 4          | 22                   | includes new `FinishReason`/error-code tests                                                                                                                  |
| `core`                 | 5          | 29                   | includes new multi-message/`ExecutorCompletion` tests                                                                                                         |
| `provider`             | 4          | 28                   | registry, retry math, model runtime (streaming/retry/timeout/cancel/latency/usage), model-executor bridge                                                     |
| `provider-mock`        | 1          | 9                    | every scenario in Section 45's list                                                                                                                           |
| `provider-openai`      | 1          | 9                    | request mapping, streamed deltas, finish-reason/usage mapping, cancellation, auth/rate-limit/context-limit/not-found/5xx error mapping — no real network call |
| `client`               | 3          | 14                   | includes new `model` field pass-through test                                                                                                                  |
| `server`               | 3          | 13                   | includes new model-routing, model-failure, and no-modelRuntime-configured tests                                                                               |
| `protocol-demo`        | 1          | 4                    | Phase 1 regression, unaffected by Phase 2                                                                                                                     |
| `model-streaming-demo` | 2          | 3 passed + 1 skipped | mandatory mock integration (3 tests); optional OpenAI smoke test correctly **SKIPPED** (no `OPENAI_API_KEY` in this environment)                              |

**Total: 131 tests passing, 1 correctly skipped, 0 failing.**

## Phase 1 Regression

Explicitly re-verified before and after all Phase 2 changes:

- `protocol-demo`'s integration suite (4 tests: full round trip, client-side cancel,
  out-of-band cancel, unknown-id 404) — all passing throughout.
- The CLI demo (`node examples/protocol-demo/dist/main.js`) was run manually and produced
  the exact expected output, both before touching any Phase 2 code and again after all
  changes.

## Mandatory End-to-End Mock Integration Test (Section 52)

`examples/model-streaming/src/integration.spec.ts` — a real `createCopilotClient`, over
real HTTP (an actual listening Fastify server, not `.inject()`), through
`@gixcopilot/provider`'s real `ModelRuntime`, to a real (in-process, deterministic)
`@gixcopilot/provider-mock` provider, streamed back as real Server-Sent Events, parsed back
into typed events by the real client transport. Covers:

1. The full ordered event sequence, with correct `usage` and `finishReason` from the model.
2. Cancelling a model-backed run produces `run.cancelled`, never `run.completed`.
3. A provider failure before the first chunk surfaces as `run.failed` with the normalized
   error code.

## Optional Real-Provider Smoke Test (Section 53)

`examples/model-streaming/src/openai-smoke.spec.ts`, gated on `describe.skipIf(!apiKey)`.
In this environment (`OPENAI_API_KEY` unset), the test run reported:

```text
[openai-smoke] SKIPPED: OPENAI_API_KEY is not set.
 ↓ src/openai-smoke.spec.ts (1 test | 1 skipped)
```

This is a correct **SKIP**, not a fabricated pass and not a failure. To actually run it:

```sh
OPENAI_API_KEY=sk-... pnpm --filter @gixcopilot/model-streaming-demo test
```

This was not run in this session (no credentials available), and is never part of the
deterministic CI requirement.

## Manual CLI Verification

```sh
node examples/model-streaming/dist/main.js "Explain event-driven architecture"
```

Produced (mock provider, default path, no credentials):

```text
Provider: mock
Model: mock-model

> Explain event-driven architecture

Explain event-driven architecture

Finish reason: stop
Input tokens: 0 | Output tokens: 0 | Total tokens: 0
```

## Module Boundary Verification (manual, per phase-gate/nx-monorepo practice)

Two deliberate violations were introduced, confirmed rejected by
`@nx/enforce-module-boundaries`, then reverted (files never committed):

1. `@gixcopilot/provider-mock` importing `@gixcopilot/provider-openai` (adapter-to-adapter) —
   rejected: `"A project tagged with 'scope:provider-adapter' can only depend on libs
tagged with 'scope:protocol', 'scope:core', 'scope:provider'"`.
2. (Carried over from Phase 1, re-verified) `@gixcopilot/protocol` importing
   `@gixcopilot/core` — rejected as a circular-dependency violation.

## Dependency/Secret Review

- `grep`-checked for hardcoded API-key-shaped strings across the repo: none found.
- `grep`-checked that no package outside `@gixcopilot/provider-openai` imports from
  `'openai'`: confirmed none do.
- `grep`-checked that no real workspace import of `@gixcopilot/provider` exists inside
  `@gixcopilot/core`'s source (only a doc-comment mention): confirmed.
