# Security

```text
Browser → Authentication → Server → Runtime → Model → tool request → ACTION FIREWALL → tool → your systems
```

**Model output is data, not authority.** The model can request, never decide.

| Area | Rule | Where |
| --- | --- | --- |
| Authentication | Identity and tenant come from your `AuthenticationAdapter` (or the reference JWT verifier in `apps/api`); set `requireAuthentication` in production | `security`, `server` |
| RBAC / ABAC | `RolePermissionMap`, `requiredPermissions` per tool, `definePolicy` for attribute rules | `security` |
| Action Firewall | Every consequential tool call: authentication, permission, schema, business policy, PII, rate limit, approval, audit, then execution. Tool *visibility* is filtered too | `createActionFirewall` |
| Risk | Tools declare `read-only` / `write` / `destructive`; unclassified tools fail closed to approval | `createDefaultRiskPolicy` |
| HITL | Approvals are recorded human/system decisions (levels up to two-person), expire, are bound to tenant and requester, and are durable across instances with `createPostgresApprovalStore`. Text such as "the manager approved" changes nothing | `security`, `persistence-postgres` |
| PII | Data policies redact fields before logging, telemetry and model context | `createFieldRedactionDataPolicy` |
| RAG | Tenant and ACL filtering before retrieval results reach the model | `rag` |
| Memory | Owner and tenant checked on every read and write; secrets rejected | `memory` |
| OpenAPI / MCP | Allowlist or deny-by-default exposure; generated tools pass the firewall | `openapi`, `mcp` |
| Generative UI | Registered components only; schema-validated props; no model-generated code | `generative-ui`, `ui`, `angular` |
| Tenants | Tenant from authentication only; storage reachable only through tenant-scoped handles | [Multi-tenancy](multi-tenancy.md) |
| Secrets | Env or mounted-file secret providers; `Secret` values redact themselves; platform secrets are write-only and AES-256-GCM encrypted | `config`, `management` |
| Audit | Append-only (a database trigger rejects updates and deletes outside the retention purge); separate from traces | `persistence-postgres` |
| DevTools | Off in production by configuration rule; token-protected and tenant-scoped when on; read-only | `devtools` |
| Platform | Authenticated, role-checked, audited; cannot weaken code-declared security | `management` |

Production checklist: `AICOPILOT_REQUIRE_AUTH=true`; a real authentication adapter; every
tool classified; approvals for write/destructive tools; durable audit and approvals
(PostgreSQL); `redacted` telemetry; DevTools off; secrets in a secret manager; run
`aicopilot doctor`. See [docs/production/SECURITY.md](../production/SECURITY.md) and ADR
[0012](../adr/0012-action-firewall-and-hitl-architecture.md).
