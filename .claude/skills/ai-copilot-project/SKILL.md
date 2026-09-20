---
name: ai-copilot-project
description: Master navigation skill for the AI Copilot SDK. Read this first for project vision, architecture direction, the 12 development phases, and which specialized skill to consult for a given task.
---

# Purpose

This is the master skill for the AI Copilot & Agent SDK project. It is a navigation/index
skill — it routes to specialized skills rather than duplicating their rules. Non-negotiable
project law (vision, the framework-independent-core principle, phase discipline, security/
testing/documentation philosophy) lives in [CONSTITUTION.md](../../../CONSTITUTION.md) at
the repo root, not here — read that first, since this file defers to it.

Read [CONSTITUTION.md](../../../CONSTITUTION.md) and this skill first in any new session on
this project. Then load the specialized skills relevant to the current task using the
routing table below.

# Technology Direction (planned, not yet installed)

TypeScript, Node.js, Nx + pnpm monorepo, Zod, Fastify, HTTP+SSE (optional WebSocket), React
(primary UI adapter), Angular (secondary UI adapter), PostgreSQL + Drizzle ORM + pgvector,
Redis + BullMQ, OpenAPI 3.1, MCP, OpenTelemetry, Vitest + Playwright, Next.js + MDX for docs,
Docker for deployment, npm for distribution.

This list describes architectural direction only. Do not install this stack, scaffold
packages, or scaffold config for it unless the current, explicitly-approved phase calls for
it. See [[dependency-policy]].

# Package Philosophy

Small, composable, independently versioned packages under a single `@gixcopilot/*` scope.
Framework SDKs (React, Angular) are thin adapters over a framework-independent core. See
[[nx-monorepo]] for package boundaries and [[sdk-design]] for developer-facing API rules.

The 12 fixed phases, the phase-gate law, and the security/testing/documentation philosophy
that used to be repeated here now live once, in
[CONSTITUTION.md](../../../CONSTITUTION.md) (Articles II–V) — see it for the phase list and
[docs/PROJECT_STATUS.md](../../../docs/PROJECT_STATUS.md) for which phase is current.

# Skill Routing Table

| Task | Required Skills |
|---|---|
| Architecture | [[project-architecture]] |
| TypeScript implementation | [[typescript-standards]] |
| Monorepo / package layout | [[nx-monorepo]] |
| Public SDK API | [[sdk-design]] |
| Protocol | [[protocol-design]] |
| Node backend | [[node-backend]] |
| React | [[react-sdk]] |
| Angular | [[angular-sdk]] |
| Model runtime | [[ai-runtime]] |
| Tools | [[tool-system]] |
| Agents | [[agent-architecture]] |
| Context | [[context-engine]] |
| Generative UI | [[generative-ui]] |
| Security | [[security]] + [[action-firewall]] |
| Approval / interrupts | [[hitl]] |
| OpenAPI | [[openapi-tools]] |
| MCP | [[mcp]] |
| RAG | [[rag]] |
| Memory | [[memory]] |
| Tracing / metrics | [[observability]] |
| Tests | [[testing]] |
| AI evaluation | [[ai-evals]] |
| DevTools | [[devtools]] |
| Database | [[database]] |
| Jobs / queues | [[redis-jobs]] |
| API design | [[api-design]] |
| Performance | [[performance]] |
| Accessibility | [[accessibility]] |
| Documentation | [[documentation]] |
| Git | [[git-workflow]] |
| Review | [[code-review]] |
| Dependencies | [[dependency-policy]] |
| Compatibility | [[backward-compatibility]] |
| Every phase, always | [[phase-gate]] |

# Phase-to-Skill Mapping

- **Phase 1**: [[project-architecture]], [[typescript-standards]], [[nx-monorepo]], [[sdk-design]], [[protocol-design]], [[testing]], [[documentation]], [[git-workflow]], [[code-review]], [[dependency-policy]], [[backward-compatibility]], [[phase-gate]]
- **Phase 2** adds: [[ai-runtime]], [[node-backend]], [[api-design]], [[observability]]
- **Phase 3** adds: [[react-sdk]], [[accessibility]], [[performance]]
- **Phase 4** adds: [[context-engine]]
- **Phase 5** adds: [[tool-system]], [[security]]
- **Phase 6** adds: [[generative-ui]]
- **Phase 7** adds: [[security]], [[action-firewall]], [[hitl]]
- **Phase 8** adds: [[openapi-tools]], [[mcp]]
- **Phase 9** adds: [[rag]], [[memory]], [[database]]
- **Phase 10** adds: [[agent-architecture]], [[redis-jobs]]
- **Phase 11** adds: [[observability]], [[devtools]], [[ai-evals]], [[testing]]
- **Phase 12** uses all relevant skills, particularly: [[angular-sdk]], [[performance]], [[documentation]], [[backward-compatibility]], [[dependency-policy]]

`phase-gate` applies at every phase, unconditionally.

# When to Apply

Load this skill at the start of any work on this project. Load specialized skills per the
table above based on the task at hand. Always load [[phase-gate]] before starting or
resuming implementation work.

# Validation Checklist

- [ ] Current phase identified and confirmed with the user before implementation begins
- [ ] Relevant specialized skills loaded per the routing table
- [ ] No architecture decision contradicts framework-independent-core
- [ ] No work performed outside the explicitly approved phase scope
