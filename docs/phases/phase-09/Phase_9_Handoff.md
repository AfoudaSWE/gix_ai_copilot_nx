# Phase 9 handoff

Use the [completion record](Phase_9_Status.md), [test evidence](Phase_9_Testing.md),
[API](Phase_9_API.md) and [limits](Phase_9_Issues.md).

## Run from the workspace root

```powershell
pnpm install
pnpm build
pnpm --filter @gixcopilot/knowledge test
pnpm --filter @gixcopilot/rag test
pnpm --filter @gixcopilot/memory test
pnpm --filter @gixcopilot/vectorstore-pgvector test   # real Postgres+pgvector via Testcontainers; auto-skips without Docker
pnpm --filter @gixcopilot/react-rag test
```

For the interactive example (real OpenAI required to answer questions), copy `.env.example` to
`.env` and supply `OPENAI_API_KEY`/`OPENAI_MODEL`; set `DATABASE_URL` to use real pgvector storage
instead of the default in-memory development stores. Never commit `.env`.

```powershell
pnpm --filter @gixcopilot/react-rag server   # terminal 1
pnpm --filter @gixcopilot/react-rag dev      # terminal 2
```

Explicit real-provider validation (also requires a disposable, migrated Postgres):

```powershell
$env:OPENAI_API_KEY='sk-...'
$env:OPENAI_MODEL='gpt-4o-mini'
$env:RAG_SMOKE_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/ragsmoke'
pnpm --filter @gixcopilot/react-rag build
pnpm --filter @gixcopilot/react-rag run smoke
Remove-Item Env:OPENAI_API_KEY,Env:OPENAI_MODEL,Env:RAG_SMOKE_DATABASE_URL
```

A disposable database for the smoke script or for manual pgvector testing:

```powershell
docker run -d --name rag-smoke-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ragsmoke -p 5433:5432 pgvector/pgvector:pg16
# apply packages/vectorstores/pgvector/migrations/0000_init.sql against it, then run the smoke script
docker rm -f rag-smoke-pg
```

Normal tests never require `OPENAI_API_KEY`, `RAG_SMOKE_DATABASE_URL`, or Docker.

## Indexing your own knowledge

Any `KnowledgeSource` + `DocumentLoader` pair works with `createIndexer`:

```ts
import { pdfSource, pdfLoader } from '@gixcopilot/knowledge';
import { createIndexer, createRecursiveChunker, createOpenAIEmbeddingProvider } from '@gixcopilot/rag';
import { createPgVectorStore } from '@gixcopilot/vectorstore-pgvector';

const vectorStore = createPgVectorStore({ connectionString: process.env.DATABASE_URL! });
const embeddingProvider = createOpenAIEmbeddingProvider({ apiKey: process.env.OPENAI_API_KEY!, model: 'text-embedding-3-small' });
await createIndexer({ vectorStore, embeddingProvider, chunker: createRecursiveChunker() }).index({
  source: pdfSource({ id: 'handbook', path: './handbook.pdf', tenantId: 'tenant-a', permissions: ['knowledge.hr.read'] }),
  loader: pdfLoader,
});
```

Set `tenantId`/`acl`/`permissions` at ingestion time — that is what `createRetriever` enforces
against a trusted `SecurityContext` later; there is no way to add authorization after the fact
without reindexing.

## Migrate an earlier Phase 9 draft

If you have code against an in-progress Phase 9 draft: `@gixcopilot/memory` did not exist before
this review — replace any placeholder/mock memory code with `createInMemoryMemoryStore`/
`createVectorBackedMemoryStore`. If you constructed `createPgVectorStore` without a `table`
option expecting it to also hold memory, switch to `table: 'memory'` for memory records — mixing
memory and knowledge rows in `knowledge_chunks` was never supported. If you imported
`createToolCallingExecutor`/`createFrontendToolBridge` from an internal server path, import them
from `@gixcopilot/server`'s public `index.ts` instead.

## Troubleshooting

- `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS`: `pnpm-workspace.yaml`'s `allowBuilds` map
  needs real `true`/`false` values, not placeholder text (this was the actual Phase 9 draft's
  state before this review — see [Issues](Phase_9_Issues.md)).
- Zero retrieved chunks: check the source's `tenantId`/`acl` against the querying identity's
  `SecurityContext`, and inspect `RetrievalDiagnostics.exclusions` for the exact reason
  (`TENANT_MISMATCH`/`ACL_DENIED`/`PERMISSION_DENIED`/`BELOW_THRESHOLD`/`DATA_POLICY`).
- `EMBEDDING_FAILED`/dimension mismatch: `createPgVectorStore`'s schema is fixed at 1536
  dimensions (`EMBEDDING_DIMENSIONS`); changing embedding models/dimensions requires a new
  migration and a full reindex (Section 178).
- Memory write rejected: the default write policy blocks credential-shaped values on purpose
  (Section 102) — use `createPermissiveMemoryWritePolicy()` only in tests/examples that
  intentionally opt out, never in production.
- pgvector integration tests skipped: Docker is unreachable in that environment; this is
  intentional graceful degradation, not a failure.
- Real smoke script errors about missing env vars: set all three of `OPENAI_API_KEY`,
  `OPENAI_MODEL`, and `RAG_SMOKE_DATABASE_URL` in the same process invocation.

No commit, deployment, or publication was requested. Stop here; Phase 10 (agents, multi-agent
orchestration, workflows) requires explicit user instruction, exactly as every prior phase gate
has held.
