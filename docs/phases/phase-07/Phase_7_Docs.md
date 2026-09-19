# Phase 7 — Enterprise Security & HITL

Phase 7 adds the mandatory gateway every consequential AI (or direct, non-AI) action now
passes through: authentication, RBAC/ABAC authorization, tenant isolation, risk-based
approval routing (user confirmation, supervisor, two-person, admin), dry-run previews, PII
redaction, and a real audit trail. It does not implement OpenAPI/MCP tool generation, RAG,
persistent memory, agents, or a DevTools platform — see [Issues](Phase_7_Issues.md) and the
phase-gate skill for the explicit boundary.

| File | Contents |
| --- | --- |
| [Architecture](Phase_7_Architecture.md) | Package boundary, the Action Firewall pipeline, HITL state machine, trust boundaries |
| [Implementation](Phase_7_Implementation.md) | Code responsibilities, dependencies, tradeoffs |
| [Status](Phase_7_Status.md) | Acceptance checklist and completion report |
| [Testing](Phase_7_Testing.md) | Executed checks and measured evidence |
| [Decisions](Phase_7_Decisions.md) | ADR index and design decisions |
| [API](Phase_7_API.md) | All exported functions, hooks and public types |
| [Files](Phase_7_Files.md) | Created and modified files |
| [Issues](Phase_7_Issues.md) | Bugs found and fixed, known limits, out-of-scope items |
| [Handoff](Phase_7_Handoff.md) | Running the example and future maintenance |

Prior records: [Phase 1](../phase-01/Phase_1_Docs.md), [Phase 2](../phase-02/Phase_2_Docs.md),
[Phase 3](../phase-03/Phase_3_Docs.md), [Phase 4](../phase-04/Phase_4_Docs.md),
[Phase 5](../phase-05/Phase_5_Docs.md), [Phase 6](../phase-06/Phase_6_Docs.md). The canonical
dependency-direction diagram remains `docs/architecture/overview.md`, extended here with the
new `@gixcopilot/security` package.

Quick start from the workspace root:

```sh
pnpm install
pnpm build
pnpm --filter @gixcopilot/react-enterprise server   # terminal 1
pnpm --filter @gixcopilot/react-enterprise dev       # terminal 2
```

Open <http://127.0.0.1:5178> — see `examples/react-enterprise/README.md`. No `OPENAI_API_KEY`
is required for the security/HITL demonstration itself (only for the optional chat panel).
