---
name: ai-copilot-project
description: Master navigation skill for the AI Copilot SDK. Read this first for project vision, architecture direction, the 12 development phases, and which specialized skill to consult for a given task.
---

# Purpose

This is the master skill for the AI Copilot & Agent SDK project. It orients Claude to the
project vision, non-negotiable architectural principles, the fixed phase plan, and the
technology direction. It is a navigation/index skill — it routes to specialized skills rather
than duplicating their rules.

Read this skill first in any new session on this project. Then load the specialized skills
relevant to the current task using the routing table below.

# Project Vision

> A framework-independent enterprise SDK for building safe, observable, application-aware
> AI copilots and agents capable of interacting with real software systems.

This is not a chatbot widget. The target surface area includes: a framework-independent
core, React and Angular SDKs, a Node.js server SDK, LLM provider adapters, streaming,
application-aware context, shared state, frontend/backend tools, structured outputs,
generative UI, human-in-the-loop approval, an AI Action Firewall, auth/RBAC/ABAC, PII
protection, audit trails, OpenAPI-to-tool generation, MCP, RAG, knowledge management,
memory, an agent runtime, multi-agent orchestration, workflows, long-running agents,
DevTools, tracing, evals, simulation, a CLI, multi-tenancy, usage tracking, cost controls,
and an enterprise management platform.

# Architectural Principle

```text
TypeScript Core
      ↓
Own Protocol
      ↓
Own Runtime
      ↓
Adapters
```

The core must remain framework-independent. React, Angular, OpenAI, Anthropic, Gemini,
Ollama, OpenAPI, MCP, PostgreSQL, and Redis are all **adapters or integrations**, never hard
dependencies baked into the core. See [[project-architecture]] for the full rule set.

# Technology Direction (planned, not yet installed)

TypeScript, Node.js, Nx + pnpm monorepo, Zod, Fastify, HTTP+SSE (optional WebSocket), React
(primary UI adapter), Angular (secondary UI adapter), PostgreSQL + Drizzle ORM + pgvector,
Redis + BullMQ, OpenAPI 3.1, MCP, OpenTelemetry, Vitest + Playwright, Next.js + MDX for docs,
Docker for deployment, npm for distribution.

This list describes architectural direction only. Do not install this stack, scaffold
packages, or scaffold config for it unless the current, explicitly-approved phase calls for
it. See [[dependency-policy]].

# The 12 Fixed Phases

```text
01 Foundation & Architecture         07 Enterprise Security & HITL
02 LLM Runtime & Streaming           08 OpenAPI + MCP + Integrations
03 React Copilot UI                  09 Knowledge + RAG + Memory
04 Application Context & State       10 Agents + Multi-Agent + Workflows
05 Tools & Agent Actions             11 DevTools + Testing + Evals + Observability
06 Generative UI & Shared State      12 Production Platform + Ecosystem
```

These phases are fixed. See [[phase-gate]] for the mandatory phase-gate protocol — this is
the single most important rule in this project: **Claude must never automatically continue
from one phase to the next.** Phase progression is explicitly controlled by the user, every
time.

# Package Philosophy

Small, composable, independently versioned packages under a single `@aicopilot/*` scope.
Framework SDKs (React, Angular) are thin adapters over a framework-independent core. See
[[nx-monorepo]] for package boundaries and [[sdk-design]] for developer-facing API rules.

# Security Philosophy

Model output is never trusted by default. Every consequential tool call passes through the
Action Firewall pipeline. Authorization is never enforced by a system prompt. See
[[security]], [[action-firewall]], and [[hitl]].

# Testing Philosophy

Deterministic tests wherever possible, real integration coverage over mocks where behavior
matters, and no claim of a passing test/build/lint that wasn't actually run. See [[testing]],
[[ai-evals]], and [[code-review]].

# Documentation Philosophy

Every package ships a README; architecture decisions are recorded as ADRs; public API
changes require compatibility review. See [[documentation]] and [[backward-compatibility]].

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
