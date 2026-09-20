# Constitution

This is the supreme, rarely-amended law of the AI Copilot & Agent SDK. Every skill, ADR,
README, and phase prompt in this repository operates under it. **If any other document
conflicts with this file, this file wins** — fix the other document, don't override this
one locally.

This file states *what is non-negotiable and why*. It deliberately does not restate *how*
to satisfy each Article — that operational detail lives in [`.claude/skills/`](.claude/skills/)
and is linked from the enforcement table at the bottom. Keeping the law and its mechanics
in separate files is intentional: the law changes rarely, the mechanics evolve per phase.

## Preamble — Vision

> A framework-independent enterprise SDK for building safe, observable, application-aware
> AI copilots and agents capable of interacting with real software systems.

Not a chatbot widget. See [README.md](README.md) for the current capability surface and
[docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) for which of the 12 phases are built.

## Article I — The Core Stays Framework-Independent

```text
Framework SDKs (React, Angular)
      ↓
Client SDK
      ↓
Protocol (Message, Thread, Run, Event, ToolCall, ToolResult, State)
      ↓
Server (Node/Fastify transport)
      ↓
Core Runtime (orchestration, lifecycle, execution)
      ↓
Agents / Context / Tools
      ↓
Adapters (LLM providers, DB, cache, MCP, OpenAPI)
```

Dependencies flow one direction only, outward from the core. `@gixcopilot/core` never
imports React, Angular, a specific LLM provider SDK, a specific database driver, or a
specific transport. Every external technology — React, Angular, OpenAI, Anthropic, Gemini,
Ollama, PostgreSQL, Redis, OpenAPI, MCP — is an **adapter implementing a core-defined
interface**, never a hard dependency baked into the core. No package depends back on an
adapter that depends on it.

## Article II — Phases Are Sequential and Never Self-Advance

Development proceeds through exactly 12 fixed phases:

```text
01 Foundation & Architecture         07 Enterprise Security & HITL
02 LLM Runtime & Streaming           08 OpenAPI + MCP + Integrations
03 React Copilot UI                  09 Knowledge + RAG + Memory
04 Application Context & State       10 Agents + Multi-Agent + Workflows
05 Tools & Agent Actions             11 DevTools + Testing + Evals + Observability
06 Generative UI & Shared State      12 Production Platform + Ecosystem
```

An agent works only on the phase the user explicitly named for the current session, never
implements a future phase's functionality because it seems useful "while in here," and
**never automatically begins the next phase** after finishing the current one — it stops
and reports instead. Current phase state is tracked in
[docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md), not in this file, because it changes
every phase and this file does not.

## Article III — Model Output Is Never Trusted by Default

Every consequential tool call — backend, frontend, or direct-invoked — passes through the
Action Firewall pipeline (auth → RBAC/ABAC → schema validation → policy → PII → rate limit
→ approval → audit → execution). Authorization is never enforced by a system prompt alone.
A model-supplied value never builds a URL, file path, or SQL fragment directly. Security
boundaries live at defined choke points, not scattered ad hoc through business logic.

## Article IV — Completion Claims Must Be Verified, Not Assumed

An agent never reports a test, lint, typecheck, or build as passing without having actually
executed it in the current session and observed the output. Deterministic tests are
preferred; real integration coverage is preferred over mocks where behavior actually
matters. A check that could not be run is disclosed as not run — never silently omitted,
never inferred from memory of an earlier pass.

## Article V — Every Decision Is Recorded, Every Package Explains Itself

An architecturally significant choice becomes an ADR under `docs/adr/`, indexed in
[docs/DECISIONS.md](docs/DECISIONS.md). Every package ships a README stating its public API
and — importantly — its **non-responsibilities**, so later phases don't quietly grow scope
the architecture never approved. A public API change is reviewed for backward compatibility
before it merges.

## Article VI — Dependencies Are Justified, Not Convenient

A new dependency is added only after the problem is stated, the platform/stdlib is checked,
and duplication with an existing dependency is ruled out. Prefer an adapter over the core
absorbing a library. "It's just one small package" is not a justification on its own.

## Amendment

This file changes only on the user's explicit instruction, never as a side effect of
implementation work. When it changes, record the change in
[docs/DECISIONS.md](docs/DECISIONS.md) like any other architectural decision.

## Enforcement — Where Each Article's Mechanics Live

| Article | Enforced by |
|---|---|
| I — Framework-independent core | [[project-architecture]], [[nx-monorepo]], [[sdk-design]] |
| II — Phase discipline | [[phase-gate]], [[ai-copilot-project]] |
| III — Trust boundary | [[security]], [[action-firewall]], [[hitl]] |
| IV — Verified completion | [[code-review]], [[testing]], [[ai-evals]] |
| V — Recorded decisions | [[documentation]], [[backward-compatibility]] |
| VI — Justified dependencies | [[dependency-policy]] |

`[[skill-name]]` resolves to `.claude/skills/<skill-name>/SKILL.md`. See
[AGENTS.md](AGENTS.md) for how an agent should use this file and those skills together.
