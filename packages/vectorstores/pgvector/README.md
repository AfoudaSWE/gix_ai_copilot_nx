# @gixcopilot/vectorstore-pgvector

> **Status:** Beta. See [stability levels](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/VERSIONING.md#stability-levels).

Production PostgreSQL + [pgvector](https://github.com/pgvector/pgvector) implementation of
`@gixcopilot/rag`'s storage-agnostic `VectorStore` contract. The only package in the workspace
depending on `drizzle-orm`/`pg` — that dependency stays out of the core RAG/memory abstractions.

## Install

```bash
npm install @gixcopilot/vectorstore-pgvector
```

Requires Node.js >=22.12.0. ESM only.

```ts
import { createPgVectorStore } from '@gixcopilot/vectorstore-pgvector';

const knowledgeStore = createPgVectorStore({ connectionString }); // knowledge_chunks (default)
const memoryStore = createPgVectorStore({ connectionString, table: 'memory' }); // memory_embeddings
```

Run once per database: `CREATE EXTENSION IF NOT EXISTS vector;` and
`migrations/0000_init.sql` (some managed Postgres providers require an admin action to enable the
extension). ACL/tenant filtering runs as a real SQL `WHERE` clause before `LIMIT` — a vector index
is a performance optimization, never the security boundary by itself; `@gixcopilot/rag`'s
retriever still re-validates every result. `search()`/`upsert()` reject an embedding whose
dimensions do not match the schema's fixed `EMBEDDING_DIMENSIONS` (1536) rather than silently
truncating it. `replace()` performs an atomic, advisory-locked delete+insert for reindexing.

Integration tests (`src/pg-vector-store.integration.spec.ts`) use
[Testcontainers](https://testcontainers.com) against a real Postgres+pgvector container and
auto-skip when Docker is unreachable — run them with
`pnpm --filter @gixcopilot/vectorstore-pgvector test` wherever Docker is available.

See [Phase 9 API](../../../docs/phases/phase-09/Phase_9_API.md),
[architecture](../../../docs/phases/phase-09/Phase_9_Architecture.md), and
[validation](../../../docs/phases/phase-09/Phase_9_Testing.md).

## Documentation

- [rag guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/rag.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/vectorstores/pgvector)

## License

MIT
