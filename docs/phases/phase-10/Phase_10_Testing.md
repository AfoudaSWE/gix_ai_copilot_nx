# Phase 10 testing

All commands below were actually executed this session via `pnpm nx run-many --skip-nx-cache`
from the workspace root; results are copied from the real terminal output, not assumed.

## Fresh full-repo validation (final pass)

```sh
pnpm install
npx nx run-many -t lint --skip-nx-cache        # 39 projects
npx nx run-many -t typecheck --skip-nx-cache   # 39 projects
npx nx run-many -t test --skip-nx-cache        # 38 projects
npx nx run-many -t build --skip-nx-cache       # 38 projects
```

**Lint**: 39/39 projects pass. Two real issues were found and fixed during this pass (not
pre-existing — introduced by this review's own edits, caught before completion):
`@typescript-eslint/no-unsafe-assignment` on an untyped `PromiseSettledResult.reason` in
`runtime.ts`'s new parallel-delegation path, `@typescript-eslint/no-unnecessary-type-assertion`
in the new React progress-hook test fixture, and `@typescript-eslint/require-await` on five
async closures with no `await` in the new BullMQ test file.

**Typecheck**: 39/39 projects pass, zero errors.

**Test**: 38/38 projects pass. **1080 tests passed, 29 skipped, 0 failed** across every
project including every Phase 1–9 test, unmodified. Skips: `checkpoint-postgres` (5,
Docker unreachable in this environment at the time of this final pass — see below for the
earlier real run), `jobs` (9, same reason), `vectorstore-pgvector` (11, pre-existing,
same reason), and four pre-existing optional real-OpenAI smoke tests across `mcp` (1),
`openapi` (2), `model-streaming` (1) that skip without `OPENAI_API_KEY` — the same
established pattern every prior phase already used.
`examples/react-generative-ui`'s own optional OpenAI smoke test happened to run for real in
this pass (that example's own pre-existing local `.env` had credentials from earlier work)
and passed; not something this review provisioned or relies on.

**Build**: 38/38 projects pass. (`@opentelemetry/api` bundling emits benign
`MODULE_LEVEL_DIRECTIVE`/"use client" warnings for `@gixcopilot/react`'s dist output when
consumed by Vite — pre-existing from Phase 3, unrelated to Phase 10, not an error.)

## Phase 10 package-level detail

| Package | Tests | Notes |
| --- | --- | --- |
| `@gixcopilot/agents` | 55 passed (12 files) | `definition`/`registry`/`limits` (inherited), `delegation`/`handoff`/`delegation-security` (4 tests, incl. this review's new knowledge/memory-narrowing test), `routing`/`planner`/`plan`/`plan-executor`, `runtime` (10, incl. 3 new cancellation/timeout tests), `parallel-delegation` (4, new), `messages` (4, new), `tracing` (2, new — real OTel span-nesting assertions). |
| `@gixcopilot/workflows` | 28 passed (6 files) | `definition`/`engine`/`approval-step`/`durability` (inherited), `reauthorization` (4, new — re-auth-on-resume, approval-forgery, prompt-injection), `tracing` (2, new). |
| `@gixcopilot/checkpoint-postgres` | 5 (skipped this pass; **run for real earlier this session**, see below) | |
| `@gixcopilot/jobs` | 9 (skipped this pass; **run for real earlier this session**, see below) | |
| `@gixcopilot/react` | 45 passed (9 files) | Every Phase 3-9 hook test unmodified, plus `agent-workflow-progress` (6, new). |
| `examples/agent-basic` | 4 passed | Real tool call, real RAG retrieval, real memory save/recall round trip, mandatory cross-user memory-isolation security test. |
| `examples/multi-agent` | 2 passed | Real parallel delegation to 3 specialists; mandatory delegation-privilege-isolation security test (a call-counting spy proves the payment tool's `execute()` is never reached for a caller without `payments.read`). |
| `examples/workflow-approval` | 3 passed | Full pause/approve/resume cycle with real state mutation, rejection path, and a genuine two-independent-engine-instance "process restart" test. |

## Real infrastructure runs (this session, prior to the final pass above)

Docker was reachable earlier in this session; both real-infrastructure suites were run for
real and passed before Docker became unavailable in this environment for the final pass:

```text
$ npx nx run jobs:test --skip-nx-cache
 ✓ src/bullmq-job-executor.spec.ts (5 tests) 2133ms   — real Redis via Testcontainers
 ✓ src/dead-letter.spec.ts (4 tests) 4773ms            — real Redis via Testcontainers
 Test Files  2 passed (2)
 Tests  9 passed (9)

$ npx nx run checkpoint-postgres:test --skip-nx-cache
 ✓ src/pg-checkpoint-store.integration.spec.ts (5 tests)   — real Postgres 16 via Testcontainers
 Test Files  1 passed (1)
 Tests  5 passed (5)
```

Covered: real job scheduling/idempotent job ids, error propagation, concurrency, dead-letter
list/get/replay/discard (jobs); real checkpoint insert/version-CAS/stale-write-rejection/
restart-resume/delete/tenant-filtering (checkpoint-postgres). Both auto-skip cleanly via
`describe.skipIf(!dockerAvailable)` when Docker is unreachable — disclosed explicitly in
both this document and [Issues](Phase_10_Issues.md) rather than silently assumed passing in
the final pass above.

## Demo scripts (actually run, not just compiled)

```sh
pnpm --filter @gixcopilot/agent-basic-demo demo
pnpm --filter @gixcopilot/multi-agent-demo demo
pnpm --filter @gixcopilot/workflow-approval-demo demo
```

All three were built (`tsc -b`) and run with `node dist/main.js` this session, against the
deterministic mock provider:

- **agent-basic**: completed with the correct, tool-derived answer ("APP-1024 is currently
  under review for Jordan Miles...").
- **multi-agent**: the orchestrator's same-turn parallel delegation to all three specialists
  was observed directly in the event log (`[agent] application-specialist started` /
  `payment-specialist started` / `knowledge-specialist started` all emitted before any
  `completed`, confirming genuine concurrency, not sequential dispatch), completing with the
  combined answer.
- **workflow-approval**: `start()` correctly paused at `waiting_for_approval`, a simulated
  supervisor approval was granted, `resume()` correctly completed the run and applied the
  real state mutation (`APP-1024` → `approved`).

## Prompt-completeness audit validation (2026-09-25)

```sh
npx nx run-many -t lint,typecheck,test,build --skip-nx-cache   # 41 projects
```

**41/41 projects pass lint, typecheck, test and build. 1154 Vitest tests passed, 4
skipped, 0 failed.** The 4 skipped tests are the optional real-OpenAI smoke tests, which need
a key in the environment. Docker was running, so the `jobs` and `checkpoint-postgres`
Testcontainers suites ran against real Redis and Postgres.

The first two full runs failed `jobs:test` with an unhandled ioredis `Connection is closed`
rejection, while all 9 `jobs` tests passed. `bullmq-job-executor.ts` started
`worker.waitUntilReady()` eagerly but only `schedule()` awaited it, so closing an executor
before its connections were ready leaked a rejection. Fixed by observing that promise and by
waiting for all three connections to settle in `close()`. After the fix, three isolated
`jobs` runs, a 30-iteration create/close stress test and the full run above were clean.
Because the full-load failure was intermittent, one clean full run supports the fix but does
not prove it.

`examples/workflow-compensation` demo (mock-free, deterministic): the shipment failed, then
`[compensation] charge-payment` and `[compensation] reserve-inventory` ran in that order;
stock returned to 10; the ledger shows the charge and the refund; no shipment created.

## Real OpenAI runs (Section 210-212)

Run manually during the prompt-completeness audit (2026-09-25) with
`MODEL_PROVIDER=openai`, `gpt-4o-mini`, and the key from the git-ignored example `.env`.
Automated tests still use only the mock provider.

```sh
MODEL_PROVIDER=openai OPENAI_API_KEY=sk-... pnpm --filter @gixcopilot/agent-basic-demo demo
MODEL_PROVIDER=openai OPENAI_API_KEY=sk-... pnpm --filter @gixcopilot/multi-agent-demo demo
MODEL_PROVIDER=openai OPENAI_API_KEY=sk-... pnpm --filter @gixcopilot/workflow-approval-demo demo
```

| Example | Result | Wall time (incl. `tsc -b` + Node start) |
| --- | --- | --- |
| agent-basic (Section 210) | **PASS** — completed; answer grounded in the tool result ("APP-1024 is currently under review ... Jordan Miles") | 7.9 s |
| multi-agent (Section 211) | **PASS** (after fix) — orchestrator fanned out to all three specialists in one turn; all three delegations completed; answer combined application status, verified card payment, and approval policy | 7.5 s |
| workflow-approval (Section 212) | **PASS** — real model only in the agent step; deterministic validate → agent → payment → prepare → paused at approval → approved → resumed → update → completed | 4.5 s |

The first multi-agent run surfaced a real defect: `payments.get` took `userId` from model
arguments, and the real model invented `user-123` for "verify my payment", so the lookup
found nothing. Identity must come from the trusted runtime context (Section 14, 59, 185), so
the tool now reads the caller from the `executionContext` the agent runtime attaches to every
tool call, and ignores any model-supplied id. A new test in
`examples/multi-agent/src/integration.spec.ts` passes a forged `userId: 'user-999'` and
asserts the trusted caller's record is returned. The re-run returned the correct verified
payment.

## Performance (Section 213)

In-process, deterministic mock provider (no network), Node 22.15.0, Windows 11; built
`dist/` output; 10 warm-up iterations then n samples. Measures SDK overhead, not model
latency.

| Measurement | n | p50 | p95 |
| --- | --- | --- | --- |
| Agent startup (new registry + runtime) + single text-only run | 200 | 0.065 ms | 0.153 ms |
| Agent run: model → tool → model | 200 | 0.121 ms | 0.231 ms |
| Delegation A → B → A | 200 | 0.178 ms | 0.396 ms |
| 3 specialists, 50 ms model each, **parallel** (one turn) | 30 | 63.7 ms | 66.6 ms |
| 3 specialists, 50 ms model each, **sequential** (three turns) | 30 | 180.6 ms | 193.7 ms |
| Workflow: 10 function steps, checkpointed after each | 200 | 0.253 ms | 0.707 ms |
| In-memory checkpoint save (CAS) + load | 200 | 0.001 ms | 0.001 ms |
| Workflow start → pause at approval | 100 | 0.029 ms | 0.092 ms |
| Resume after approval → tool step → complete | 50 | 0.067 ms | 0.154 ms |

Runtime overhead is sub-millisecond everywhere; end-to-end latency is dominated by the
model (the real runs above). Parallel delegation cuts three independent 50 ms specialists
from ~181 ms to ~64 ms.

Token usage (Section 214): the Phase 10 runtime as committed only passed `usage.updated`
events through and did **not** aggregate usage per run. Per-run aggregation (`addUsage`, with
each child run recording its own usage so the root does not double-count) arrives with the
in-progress Phase 11 `@gixcopilot/telemetry` work, not Phase 10.

## Not run (disclosed, not assumed)

- **BullMQ job-queue latency and Postgres checkpoint/resume latency were not benchmarked.**
  Docker was not running during the prompt-completeness audit, so the `jobs` and
  `checkpoint-postgres` Testcontainers suites skipped there; they passed with Docker in the
  earlier session (see above).
- **The Chromium/Playwright browser suite (`react-e2e`) was not re-run this session** — no
  Phase 10 browser UI surface was added to it; its lint/typecheck targets were re-run above
  and pass.
