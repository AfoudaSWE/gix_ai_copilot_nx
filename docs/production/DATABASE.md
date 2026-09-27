# Database (PostgreSQL + Drizzle + pgvector)

**Tables** (`@gixcopilot/persistence-postgres`, `checkpoint-postgres`, `vectorstore-pgvector`):
`threads`, `messages`, `runs`, `memory_records`, `audit_records`, `usage_events`, `approvals`,
`tenants`, `projects`, `environments`, `memberships`, `resources`, `resource_versions`,
`secrets` (ciphertext only), `workflow_runs`, `knowledge_chunks`, `memory_embeddings`. Every
tenant-owned table carries `tenant_id` as the leading key/index column. Repositories are
reachable only through tenant-scoped handles.

**Migrations**:
- **Generate**: edit `src/schema.ts`, then `pnpm --filter @gixcopilot/persistence-postgres
  db:generate`.
- **Review**: read the SQL and add hand-written parts (triggers, cross-column constraints).
  Write a `.down.sql` when a safe rollback exists.
- **Apply**: `aicopilot db migrate`. It takes an advisory lock (concurrent instances wait),
  runs one transaction per migration, records checksums (an edited, already-applied migration
  stops the run), and orders sources: checkpoints, pgvector, then platform.
- **Rollback**: `aicopilot db rollback --yes` runs only a reviewed `.down.sql`, and refuses
  when there is none (pgvector). Rollbacks are destructive; after real data exists, prefer
  restore plus a forward fix.
- **Never** at application startup: `/ready` stays 503 while migrations are pending.

**Breaking schema changes** use expand/migrate/contract:
1. Expand: add new columns or tables, compatible with the old code.
2. Deploy code that writes both and reads new-with-fallback.
3. Backfill.
4. Deploy code that uses only the new shape.
5. Contract: drop the old parts in a later release.

Software rollback is safe during steps 1–4 because the old code still works on the expanded
schema.

**Indexes** follow query patterns: `(tenant_id, updated_at)` threads by recency,
`(tenant_id, subject)`, `(tenant_id, thread_id, seq)` messages, `(tenant_id, started_at)`
runs, `(tenant_id, owner, type, updated_at)` memory, `(tenant_id, timestamp | actor | action |
run_id)` audit, `(tenant_id, occurred_at | project | model)` usage, HNSW cosine on
embeddings. Lists use keyset pagination (no OFFSET scans).

**pgvector**: embedding dimension is fixed per table (1536); changing models needs a new
migration and a full reindex. The vector index speeds retrieval but never replaces the tenant
and ACL filter.

**Audit** is append-only in the database: a trigger rejects `UPDATE` and any `DELETE` outside
the retention purge (`SET LOCAL aicopilot.audit_retention_purge = 'on'`, used only by the
worker).
