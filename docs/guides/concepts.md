# Concepts

```text
UI (React · Angular · your own)  ──HTTP/SSE──▶  Server (Fastify / Node)  ──▶  Model runtime ──▶ provider adapter
        ▲  protocol events                         │
        └──────────────────────────────────────────┤ tools ─▶ Action Firewall ─▶ your systems
                                                    │ context · RAG · memory · agents · workflows
                                                    └ telemetry ─▶ DevTools · platform · OpenTelemetry
```

| Concept | What it is | Package |
| --- | --- | --- |
| Run | One turn: the server streams typed protocol events (`run.started`, `message.delta`, `tool.*`, `approval.*`, `run.completed`) | `protocol`, `server`, `client` |
| Model runtime | Provider-independent streaming, retries, timeouts, cancellation, usage | `provider`, `provider-openai`, `provider-mock`, `model-router` |
| Context | Explicit application context the model may see, prioritized and budgeted | `context` |
| State | Shared application state; the model can only *propose* validated patches | `context`, `generative-ui` |
| Tool | A typed capability with schemas and a declared risk | `tools` |
| Action Firewall | The one enforcement point for every consequential action: authentication, RBAC/ABAC, policies, PII, rate limits, approvals, audit | `security` |
| Approval (HITL) | A recorded human/system decision; model text is never an approval | `security` |
| Generative UI | The model selects a registered component and supplies schema-valid props; it never writes code | `generative-ui`, `ui`, `angular` |
| RAG | Retrieval with permission filtering *before* text reaches the model, with citations | `knowledge`, `rag`, `vectorstore-pgvector` |
| Memory | Working, session, durable and semantic memory, owned by a user/tenant | `memory` |
| Agents & workflows | Agents with least privilege, delegation and handoff; durable, checkpointed workflows | `agents`, `workflows`, `jobs` |
| Tenant scope | Tenant, project and environment from the authenticated identity only | `tenancy` |
| Telemetry, DevTools, evals | Redacted traces, an inspector, a testing SDK, evaluations with security hard gates | `telemetry`, `devtools`, `testing`, `evals` |
| Control plane | Configuration and inspection (management API + platform), separate from the data plane | `management`, `apps/platform` |

Principles that never change: model output is data, not authority. Tools are capabilities.
Security decides. Approvals come from humans or systems. RAG and memory respect users and
tenants. The platform configures the system but cannot bypass it.
