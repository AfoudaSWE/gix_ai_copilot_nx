# Architecture overview

The Phase 1 design record ([architecture/overview.md](architecture/overview.md), ADRs
0001–0005) still holds. This page is the whole-system view after Phase 12.

```text
                        DEVELOPERS ── CLI (aicopilot) · Docs portal (apps/docs)
                                          │
                 React (react, ui) · Angular (angular) · Node (node)      ← framework adapters
                                          │
                     headless (chat store) · client (HTTP/SSE)            ← SDK APIs
                                          │
                                   PROTOCOL (typed events)
                                          │
                  server (Fastify) ── admission · observers · operations
                                          │
   context · tools ─▶ ACTION FIREWALL (security) · generative-ui · rag · memory · agents · workflows
                                          │
                     model-router ─▶ provider ─▶ provider-openai · provider-mock · (your adapters)
                                          │
      persistence-postgres (+checkpoint-postgres, vectorstore-pgvector) · redis · jobs (BullMQ) → apps/worker
                                          │
                 telemetry ─▶ OpenTelemetry · devtools (apps/devtools) · usage · evals
                                          │
         CONTROL PLANE: management (/management/v1) ─▶ apps/platform      [separate from the data plane]
```

**Dependency direction** (lint-enforced): framework adapters → SDK APIs → core/runtime →
protocol. Every package is tagged `platform:browser`, `platform:neutral` or
`platform:server`. Browser packages may depend only on browser/neutral packages, and
browser/neutral sources may not import Node built-ins, Fastify, pg, ioredis, BullMQ, OpenAI or
Drizzle. External technologies (OpenAI, PostgreSQL, Redis, MCP, OpenAPI, React, Angular) enter
only through adapter packages; `core` depends on `protocol` only.

**Data plane vs control plane**: the API serves runs from resolved configuration snapshots
(content-addressed, cached with last-good fallback). The management API changes configuration
through authorized, audited, versioned resources. A platform outage does not stop user
traffic, and an edit never mutates a run in flight.

**Tenancy**: tenant, project and environment come from authentication and flow through runs,
context, tools, RAG, memory, agents, workflows, audit, usage and telemetry. Storage is
reachable only through tenant-scoped handles.

**Package map**

| Layer | Packages |
| --- | --- |
| Protocol and core | `protocol`, `core` |
| Client and adapters | `client`, `headless`, `react`, `ui`, `angular` |
| Server and composition | `server`, `node`, `config`, `cli` |
| Models | `provider` (provider-core), `provider-openai`, `provider-mock`, `model-router` |
| Capabilities | `context`, `tools`, `generative-ui`, `security`, `openapi`, `mcp`, `integrations`, `knowledge`, `rag`, `memory`, `agents`, `workflows` |
| Production services | `tenancy`, `persistence-postgres`, `checkpoint-postgres`, `vectorstore-pgvector`, `redis`, `jobs`, `usage`, `management` |
| Quality | `telemetry`, `devtools`, `testing`, `evals` |
| Apps | `apps/api`, `apps/worker`, `apps/platform`, `apps/devtools`, `apps/docs` |

Decisions: [DECISIONS.md](DECISIONS.md) and [adr/](adr/).
