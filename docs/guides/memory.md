# Memory

Memory is distinct from conversation history and from RAG: `working`, `session`, `durable` and
`semantic`, each with a TTL, owned by a `user`, `session`, `tenant`, `workspace` or
`application` derived from the trusted `SecurityContext`.

- `createMemoryService({ store, securityContext, persistence: 'explicit-confirmation' })`:
  durable writes need explicit confirmation, credential-looking values are rejected, and every
  access is checked (`assertMemoryAccess`) and audited.
- Stores: in-memory; PostgreSQL (`persistence.memory()`, owner **and** tenant in every query);
  vector-backed semantic memory on pgvector.
- Cross-user and cross-tenant reads are impossible through these APIs (tested on real
  PostgreSQL with two tenants).
- Lifecycle: expired records are purged by the worker; user data deletion removes a subject's
  records.

ADR [0014](../adr/0014-knowledge-rag-memory-architecture.md).
