# Phase 10 — Agents + Multi-Agent + Workflows

Phase 10 adds an enterprise agent runtime (`@gixcopilot/agents`: declarative agents,
registry, execution, routing, delegation, handoff, planner/executor) and a deterministic
workflow engine (`@gixcopilot/workflows`: typed steps, checkpoints, retry, compensation,
pause/resume/cancel) to the SDK, plus two leaf persistence/background-execution adapters
(`@gixcopilot/checkpoint-postgres`, `@gixcopilot/jobs`). Every consequential action —
whether requested by an autonomous agent or a workflow step — still passes through the
*existing* Phase 5 tool runtime and Phase 7 Action Firewall unchanged; agents reuse the
*existing* Phase 2 model runtime and Phase 9 knowledge/memory primitives at the tool
boundary. There is no second tool-execution pipeline, no second approval engine, and no
third-party agent framework dependency in the core (Article I). It does not implement a
DevTools/replay platform, a full evaluation platform, Angular, or an enterprise admin
platform — see [Issues](Phase_10_Issues.md) and the phase-gate skill for the explicit
boundary.

| File | Contents |
| --- | --- |
| [Architecture](Phase_10_Architecture.md) | Package boundaries, agent/workflow execution model, security model |
| [Implementation](Phase_10_Implementation.md) | Code responsibilities, dependencies, tradeoffs |
| [Status](Phase_10_Status.md) | Acceptance checklist and completion report |
| [Testing](Phase_10_Testing.md) | Executed checks and measured evidence, including real Redis/Postgres runs |
| [Decisions](Phase_10_Decisions.md) | ADR index and design decisions |
| [API](Phase_10_API.md) | All exported functions and public types |
| [Files](Phase_10_Files.md) | Created and modified files |
| [Issues](Phase_10_Issues.md) | Bugs found and fixed, known limits, out-of-scope items |
| [Handoff](Phase_10_Handoff.md) | Running the examples and future maintenance |

Prior records: [Phase 1](../phase-01/Phase_1_Docs.md) through
[Phase 9](../phase-09/Phase_9_Docs.md). The canonical dependency-direction diagram remains
`docs/architecture/overview.md`, extended here with `@gixcopilot/agents`,
`@gixcopilot/workflows`, `@gixcopilot/jobs`, and `@gixcopilot/checkpoint-postgres`.

Quick start from the workspace root:

```sh
pnpm install
pnpm build
pnpm --filter @gixcopilot/agents test
pnpm --filter @gixcopilot/workflows test
pnpm --filter @gixcopilot/agent-basic-demo demo
pnpm --filter @gixcopilot/multi-agent-demo demo
pnpm --filter @gixcopilot/workflow-approval-demo demo
pnpm --filter @gixcopilot/workflow-compensation-demo demo
```

`@gixcopilot/jobs` (real BullMQ/Redis) and `@gixcopilot/checkpoint-postgres` (real
Drizzle/Postgres) both auto-skip their integration suites without Docker — see
[Handoff](Phase_10_Handoff.md) for how to run them for real.
