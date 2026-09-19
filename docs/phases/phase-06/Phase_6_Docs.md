# Phase 6 — Generative UI & Shared State

Phase 6 lets the model drive interactive application UI and propose shared-state changes
safely: a trusted component registry, structured (schema-validated) UI requests carried
entirely over the canonical Phase 5 tool-calling pipeline, custom tool-result renderers, and
an AI-writable extension to Phase 4's shared state with revision/conflict handling. It does
not implement the Action Firewall, RBAC/ABAC, approval/HITL, OpenAPI/MCP integration, RAG,
memory, or agents — see [Issues](Phase_6_Issues.md) and the phase-gate skill for the explicit
boundary.

| File                                        | Contents                                            |
| -------------------------------------------- | ---------------------------------------------------- |
| [Architecture](Phase_6_Architecture.md)     | Package boundary, generative-UI and state-patch pipelines, diagrams |
| [Implementation](Phase_6_Implementation.md) | Code responsibilities, dependencies, tradeoffs      |
| [Status](Phase_6_Status.md)                 | Acceptance checklist and completion report          |
| [Testing](Phase_6_Testing.md)               | Executed checks and measured evidence               |
| [Decisions](Phase_6_Decisions.md)           | ADR index and design decisions                      |
| [API](Phase_6_API.md)                       | All exported functions, hooks and public types      |
| [Files](Phase_6_Files.md)                   | Created and modified files                          |
| [Issues](Phase_6_Issues.md)                 | Bugs found and fixed, known limits, out-of-scope items |
| [Handoff](Phase_6_Handoff.md)               | Running the example and future maintenance          |

Prior records: [Phase 1](../phase-01/Phase_1_Docs.md), [Phase 2](../phase-02/Phase_2_Docs.md),
[Phase 3](../phase-03/Phase_3_Docs.md), [Phase 4](../phase-04/Phase_4_Docs.md),
[Phase 5](../phase-05/Phase_5_Docs.md). The canonical dependency-direction diagram remains
`docs/architecture/overview.md`, extended here with the `@gixcopilot/generative-ui` package.

Quick start from the workspace root:

```sh
pnpm install
pnpm build
pnpm --filter @gixcopilot/react-generative-ui server   # terminal 1
pnpm --filter @gixcopilot/react-generative-ui dev       # terminal 2
```

Open <http://127.0.0.1:5177> — see `examples/react-generative-ui/README.md`.
