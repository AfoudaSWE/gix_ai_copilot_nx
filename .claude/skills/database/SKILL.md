---
name: database
description: PostgreSQL + Drizzle ORM + pgvector persistence standards - schema conventions, migrations, transactions, indexes, tenant keys, and repository/adapter boundaries. Load when writing schema, migrations, or data-access code.
---

# Purpose

Define persistence conventions so the database layer stays a swappable adapter behind the
core, per [[project-architecture]], while remaining safe and performant.

# When to Apply

Writing or reviewing a schema, migration, query, transaction, or repository/data-access
code.

# Required Rules

- Preferred stack: PostgreSQL, Drizzle ORM, pgvector for vector search (see [[rag]]). Do
  not introduce a second ORM or a second database engine without a documented reason (see
  [[dependency-policy]]).
- The core runtime never imports Drizzle or a Postgres driver directly — data access lives
  behind a repository/adapter interface defined in the core, implemented in a persistence
  package, per [[project-architecture]].
- Every multi-tenant table includes an explicit tenant key column, indexed, and every query
  against it is scoped by that key derived from the authenticated session — never from
  client/model-supplied input (see [[security]]).
- Migrations are additive and reversible where practical; a migration that drops or
  destructively alters a column ships with a documented rollout plan (backfill, dual-write,
  or explicit breaking-change approval per [[backward-compatibility]]).
- Every table has `createdAt`/`updatedAt` timestamps; tables subject to concurrent updates
  use optimistic concurrency (a version column or `updatedAt` compare-and-swap) rather than
  assuming last-write-wins is safe.
- Transactions wrap multi-statement operations that must be atomic (e.g. writing a `Run`
  and its initial `Event` together) — partial writes from a failed multi-step operation are
  not acceptable.
- Indexes are added deliberately for every query pattern introduced (tenant key, frequently
  filtered columns, vector similarity indexes for pgvector) — not added reactively only
  after a production slowdown, and not added speculatively for unused query patterns.
- Vector columns (pgvector) follow the retrieval/ACL rules in [[rag]] — a vector index does
  not replace the ACL filter stage.

# Anti-Patterns

- A core package importing `drizzle-orm` or `pg` directly instead of going through a
  repository interface.
- A query filtering by tenant id taken from a request body field instead of the
  authenticated session.
- A destructive migration with no rollback/backfill plan.
- A hot table with no index on its most common filter column.
- Introducing a second ORM for "a quick script" instead of reusing the existing schema
  layer.

# Validation Checklist

- [ ] No core package depends on the Postgres driver or ORM directly
- [ ] Every multi-tenant query is scoped by a session-derived tenant key
- [ ] New migrations are additive or ship with an explicit breaking-change/rollout plan
- [ ] Multi-statement atomic operations are wrapped in a transaction
- [ ] New query patterns have a supporting index
