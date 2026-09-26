# Phase 11 — DevTools + Testing + Evals + Observability

Phase 11 makes the copilot runtime observable, inspectable, testable, replayable and
measurable, without changing how it executes:

- **`@gixcopilot/telemetry`** (started before this session, completed here): the
  `TelemetryAdapter` port with no-op, OpenTelemetry and in-memory recording adapters; semantic
  conventions; a versioned internal diagnostics channel; safe redaction modes; head sampling;
  metrics; configurable cost estimation; and instrumentation wrappers for every runtime seam.
- **`@gixcopilot/devtools`**: a read-only projection of recorded diagnostics into runs,
  messages, context, state, tools, security, RAG, memory, agents, workflows, events, traces and
  errors, with viewer scoping, safe debug bundles, and an opt-in, authenticated, read-only
  Fastify transport.
- **`apps/devtools`**: the React DevTools UI.
- **`@gixcopilot/testing`**: deterministic test models, tool mocks and assertions, fixtures for
  security, RAG, memory and approvals, agent and workflow simulation, a copilot test harness,
  and replay that never repeats side effects.
- **`@gixcopilot/evals`**: versioned datasets, execution records derived from recordings,
  deterministic evaluators, reports, baseline comparison, experiments, and CI gates in which
  security is a hard gate.
- Examples: **`examples/devtools`** (one app, one inspected session, execution-generated trace)
  and **`examples/evals`** (deterministic and live OpenAI evaluation with adversarial cases).

The principle, from the Phase 11 brief: telemetry tells us what happened; DevTools helps us
understand why; testing proves deterministic behavior; evals measure AI behavior; replay
reproduces problems safely; security decides what is allowed; audit records what matters for
compliance. These responsibilities stay separate.

| File | Contents |
| --- | --- |
| [Architecture](Phase_11_Architecture.md) | Telemetry, DevTools, replay, testing and evals architecture, with diagrams |
| [Implementation](Phase_11_Implementation.md) | Code responsibilities, runtime changes, tradeoffs |
| [Status](Phase_11_Status.md) | Acceptance checklist and completion report |
| [Testing](Phase_11_Testing.md) | Executed checks, real OpenAI eval runs, performance measurements |
| [Decisions](Phase_11_Decisions.md) | ADR index and design decisions |
| [API](Phase_11_API.md) | Exported functions and types |
| [Files](Phase_11_Files.md) | Created and modified files |
| [Issues](Phase_11_Issues.md) | Bugs found and fixed, known limits, out-of-scope items |
| [Handoff](Phase_11_Handoff.md) | Running everything, and using the SDK in an application |

Quick start from the workspace root:

```sh
pnpm install && pnpm build
SEED_SCENARIO=1 pnpm --filter @gixcopilot/devtools-demo start   # host + DevTools API on :4100
pnpm --filter @gixcopilot/devtools-app dev                      # DevTools UI on :5180 (token: local-dev-token)
pnpm --filter @gixcopilot/evals-demo eval                       # deterministic eval, CI gate
```

Prior records: [Phase 1](../phase-01/Phase_1_Docs.md) through [Phase 10](../phase-10/Phase_10_Docs.md).
