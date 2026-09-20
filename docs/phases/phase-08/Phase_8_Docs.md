# Phase 8 — OpenAPI + MCP + Integrations

Phase 8 lets the SDK generate canonical AI tools automatically from two external capability
sources — an OpenAPI 3.0/3.1 specification and a Model Context Protocol (MCP) server — instead
of every tool being hand-written. Both sources produce ordinary `ToolDefinition`s that register
into the exact same `ToolRegistry`/`ToolRuntime` Phase 5 built and are enforced by the exact
same Action Firewall Phase 7 built — there is no second tool architecture and no second
authorization mechanism. It does not implement RAG/vector search, persistent memory, agents, or
a DevTools platform — see [Issues](Phase_8_Issues.md) and the phase-gate skill for the explicit
boundary.

| File | Contents |
| --- | --- |
| [Architecture](Phase_8_Architecture.md) | Package boundaries, the OpenAPI and MCP generation pipelines, the unified tool architecture |
| [Implementation](Phase_8_Implementation.md) | Code responsibilities, dependencies, tradeoffs |
| [Status](Phase_8_Status.md) | Acceptance checklist and completion report |
| [Testing](Phase_8_Testing.md) | Executed checks and measured evidence |
| [Decisions](Phase_8_Decisions.md) | ADR index and design decisions |
| [API](Phase_8_API.md) | All exported functions and public types |
| [Files](Phase_8_Files.md) | Created and modified files |
| [Issues](Phase_8_Issues.md) | Bugs found and fixed, known limits, out-of-scope items |
| [Handoff](Phase_8_Handoff.md) | Running the examples and future maintenance |

Prior records: [Phase 1](../phase-01/Phase_1_Docs.md), [Phase 2](../phase-02/Phase_2_Docs.md),
[Phase 3](../phase-03/Phase_3_Docs.md), [Phase 4](../phase-04/Phase_4_Docs.md),
[Phase 5](../phase-05/Phase_5_Docs.md), [Phase 6](../phase-06/Phase_6_Docs.md),
[Phase 7](../phase-07/Phase_7_Docs.md). The canonical dependency-direction diagram remains
`docs/architecture/overview.md`, extended here with the new `@gixcopilot/openapi`,
`@gixcopilot/mcp`, and `@gixcopilot/integrations` packages.

Quick start from the workspace root:

```sh
pnpm install
pnpm build
pnpm --filter @gixcopilot/example-openapi test
pnpm --filter @gixcopilot/example-mcp test
```

Both examples also have an interactive `pnpm demo` (real OpenAI) and an optional real-provider
check (`RUN_OPENAI_SMOKE=1` plus `OPENAI_API_KEY`, run explicitly against `openai-smoke.spec.ts`)
— see each example's own README and [Phase 8 Handoff](Phase_8_Handoff.md) for exact commands.
