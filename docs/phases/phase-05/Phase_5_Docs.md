# Phase 5 — Tools & Agent Actions

Phase 5 introduces the canonical tool architecture: a new framework-independent
`@gixcopilot/tools` package (definitions, registry, resolver, execution runtime), a
provider-neutral Model → Tool → Model loop in `@gixcopilot/server`, and both backend
(server-executed) and frontend (browser-executed) tools sharing one model. It does not
implement Generative UI, an Action Firewall, HITL/approval, OpenAPI/MCP auto-generation, RAG,
memory, or agents — see [Issues](Phase_5_Issues.md) and the phase-gate skill for the explicit
boundary.

| File                                        | Contents                                             |
| -------------------------------------------- | ----------------------------------------------------- |
| [Architecture](Phase_5_Architecture.md)     | Package boundary, tool pipeline, protocol, diagrams  |
| [Implementation](Phase_5_Implementation.md) | Code responsibilities, dependencies, tradeoffs       |
| [Status](Phase_5_Status.md)                 | Acceptance checklist and completion report           |
| [Testing](Phase_5_Testing.md)               | Executed checks and measured evidence                |
| [Decisions](Phase_5_Decisions.md)           | ADR index and design decisions                       |
| [API](Phase_5_API.md)                       | All exported functions, hooks and public types       |
| [Files](Phase_5_Files.md)                   | Created and modified files                           |
| [Issues](Phase_5_Issues.md)                 | Known limits and explicitly out-of-scope items       |
| [Handoff](Phase_5_Handoff.md)               | Running the example and future maintenance           |

Prior records: [Phase 1](../phase-01/Phase_1_Docs.md), [Phase 2](../phase-02/Phase_2_Docs.md),
[Phase 3](../phase-03/Phase_3_Docs.md), [Phase 4](../phase-04/Phase_4_Docs.md). The canonical
dependency-direction diagram remains `docs/architecture/overview.md`, extended here with the
`@gixcopilot/tools` package.

Quick start from the workspace root:

```sh
pnpm install
pnpm build
pnpm --filter @gixcopilot/react-tools server   # terminal 1
pnpm --filter @gixcopilot/react-tools dev       # terminal 2
```

Open <http://127.0.0.1:5176> — see `examples/react-tools/README.md`.
