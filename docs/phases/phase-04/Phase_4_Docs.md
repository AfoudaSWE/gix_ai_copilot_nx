# Phase 4 — Application Context & State

Phase 4 makes the Copilot understand the application surrounding the conversation: a
framework-independent context engine and shared-state store, plus their React adapters. It
does not implement tools, Generative UI, agents, RAG, memory, or security enforcement — see
[Issues](Phase_4_Issues.md) and the phase-gate skill for the explicit boundary.

| File                                        | Contents                                            |
| -------------------------------------------- | ---------------------------------------------------- |
| [Architecture](Phase_4_Architecture.md)     | Package boundary, context/state pipelines, diagrams |
| [Implementation](Phase_4_Implementation.md) | Code responsibilities, dependencies, tradeoffs      |
| [Status](Phase_4_Status.md)                 | Acceptance checklist and completion report          |
| [Testing](Phase_4_Testing.md)               | Executed checks and measured evidence               |
| [Decisions](Phase_4_Decisions.md)           | ADR index and design decisions                      |
| [API](Phase_4_API.md)                       | All exported functions, hooks and public types      |
| [Files](Phase_4_Files.md)                   | Created and modified files                          |
| [Issues](Phase_4_Issues.md)                 | Known limits and explicitly out-of-scope items      |
| [Handoff](Phase_4_Handoff.md)               | Running the example and future maintenance          |

Prior records: [Phase 1](../phase-01/Phase_1_Docs.md), [Phase 2](../phase-02/Phase_2_Docs.md),
[Phase 3](../phase-03/Phase_3_Docs.md). The canonical dependency-direction diagram remains
`docs/architecture/overview.md`, extended here with the `@gixcopilot/context` package.

Quick start from the workspace root:

```sh
pnpm install
pnpm build
pnpm --filter @gixcopilot/react-context server   # terminal 1
pnpm --filter @gixcopilot/react-context dev       # terminal 2
```

Open <http://127.0.0.1:5175> — see `examples/react-context/README.md`.
