# Multi-tenancy

```text
Tenant (Acme) → Project (Visa Platform) → Environment (development · staging · production)
```

**Where the tenant comes from.** Only authentication. The adapter returns an identity whose
trusted attributes carry `tenantId` (and optionally `projectId`, `environment`);
`scopeFromSecurityContext` turns that into a `RuntimeScope`. Request bodies and model output
can never set or change it.

**How it propagates.** request → run (telemetry correlation) → context → tools (the firewall
sees the tenant) → RAG (retriever tenant filter) → memory (owner + tenant) → agents (same
security context) → workflows (checkpoint tenant) → audit (`tenantId` on every record) →
usage → traces (DevTools and the platform scope by tenant).

**How storage enforces it.** Tenant-owned data is reachable only through tenant-scoped
handles such as `conversations.forTenant(scope)` and `audit.forTenant(scope)`. Their methods
take no tenant argument, so a query cannot forget the filter. Every table leads its indexes
with `tenant_id`.

**Tested isolation** (real PostgreSQL + pgvector, two tenants): threads, messages and runs;
memory (cross-tenant and cross-user); knowledge retrieval; workflow resume, cancel and read;
audit search; control-plane configuration; usage; traces; and the whole running stack in the
container smoke test.

Platform roles are per tenant (`viewer` < `operator` < `admin` < `owner`, optionally limited
to projects). Platform administrators manage tenants but see no tenant data without a
membership. See [docs/production/SECURITY.md](../production/SECURITY.md).
