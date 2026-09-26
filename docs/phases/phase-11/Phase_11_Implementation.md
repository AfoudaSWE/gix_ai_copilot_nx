# Phase 11 implementation notes

## Starting point

`@gixcopilot/telemetry` and its wiring into `server`, `agents` and `workflows` were built before
this session (commit `2518393`). `packages/devtools` contained only a type sketch and a plugin
importing a missing module. Nothing else existed: no `testing`, `evals`, DevTools app, examples
or Phase 11 docs.

## `@gixcopilot/telemetry` (completed)

| Change | Why |
| --- | --- |
| `sampling.ts` (`createRatioSampler`, `alwaysSample`, `neverSample`); `shouldSample` on the recording adapter | Section 159. Spans only; diagnostics stay complete. |
| `logs.ts` (`recordLog`) | Structured, correlated, redacted logs through the port. |
| `globalThis.crypto.randomUUID()` instead of `node:crypto` | The package is now browser-safe, so the DevTools app can use it. |
| Redaction: numbers under token/auth keys and booleans are not secrets | Bug fix. Token counts on spans and `authorizedCount` on retrievals were being recorded as `[REDACTED]`. |
| `overhead.spec.ts` covers the OpenTelemetry adapter | Section 158. |

## Runtime changes (additive)

- `agents/runtime.ts`: every emitted event is also recorded as a `protocol.event` diagnostic
  (tenant-tagged). The `agent.run` span gets `copilot.agent.version`, `visible_tools`,
  `knowledge_sources`, `memory_types`, model provider and name, and limits (identifiers only,
  never instructions).
- `workflows/engine.ts`: start and resume listeners also record `protocol.event` diagnostics.
  The `workflow.run` span carries `copilot.workflow.steps` (`id:type:dep1|dep2`).

No behavior changes when telemetry is disabled: the listener and runtime objects are returned
unchanged.

## `@gixcopilot/devtools`

| File | Responsibility |
| --- | --- |
| `types.ts` | Session and inspector record types; `DebugBundle` |
| `session.ts` | `projectSession`: tenant scoping (ownership propagates down run trees; unknown ownership is invisible), memory subject scoping, run records |
| `inspectors.ts` | One pure selector per panel; joins key on run id plus tool-call id |
| `bundle.ts` | Export re-sanitized to the stricter of requested and recorded mode; validated, inert import |
| `recorder.ts` | `createDevTools({ source })`: viewer-scoped session, run, subscribe, export |
| `server/plugin.ts` | Opt-in, authenticated, production-refusing, read-only Fastify routes plus SSE |

## `apps/devtools`

React 19 + Vite. `api.ts` (fetch with a bearer header, fetch-based SSE follow, bundle and eval
import), `components.tsx` (badges with text, captioned tables, safe/raw payload, pager),
`panels/*` (fifteen panels), `app.tsx` (shell, ARIA tablist, focus management, status region,
run scope, raw and RTL toggles). There is no control that executes, approves or mutates.

## `@gixcopilot/testing`

`model.ts` (request-aware scripted provider), `tools.ts` (mocks and assertions), `security.ts`,
`knowledge.ts`, `memory.ts`, `approvals.ts` (fixtures and assertions), `stack.ts` (the server's
tool and firewall telemetry wiring, reused), `simulation.ts` (agents with `routeAndRun`,
workflows with `restart`), `harness.ts`, `replay.ts`, `clock.ts`, `assert.ts`.

## `@gixcopilot/evals`

`types.ts`, `record.ts` (`buildExecutionRecord` over DevTools selectors, `deriveOutcome`,
`defineEvalDataset`), `evaluators/*` (tools, rag, agents, quality, performance, judge),
`runner.ts` (`createEvalRunner`, `summarize`), `compare.ts` (`compareEvalRuns`,
`runExperiment`), `gates.ts`, `report.ts`, `storage.ts` (in-memory and file), `from-run.ts`.

## New dependencies

None from npm. New workspace packages only (`devtools`, `testing`, `evals`, `devtools-app`).
The app uses React, Vite, Testing Library and jsdom at the same pinned versions as the existing
React examples. `fastify` is an optional peer of `@gixcopilot/devtools`, used only by the
`/server` subpath.

## Notable tradeoffs

- **Protocol unchanged.** Diagnostics are a separate internal channel (Section 152), so there
  was no protocol version bump.
- **Tenant-scoped live stream** re-projects on each event. That is simple and correct, but costs
  O(session) per event; acceptable for a development tool (see Issues).
- **Evals depend on devtools** so an eval record and a DevTools view are one projection, not two.
- **Groundedness is lexical.** It is deterministic and cheap, catches unsupported claims, and is
  labeled heuristic. An LLM judge is an optional adapter.
- **Worst-case scripted models** in the eval example deliberately attempt attacks, so evals test
  the system's refusal rather than the model's manners.
