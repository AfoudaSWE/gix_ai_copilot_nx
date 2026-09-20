# @gixcopilot/rag

Framework-independent chunking, embeddings, a storage-agnostic vector store contract, permission-
aware retrieval, reranking, and citations for the AI Copilot SDK. Retrieval reuses Phase 7's
`SecurityContext`/`Policy`/`DataPolicy` directly — there is no second authorization model — and
produces plain, duck-typed contributions for the real Phase 4 `ContextEngine`, never a second
prompt-construction engine.

This is a private workspace package. Install workspace dependencies with `pnpm install`; a
workspace host declares `"@gixcopilot/rag": "workspace:*"` in its dependencies. Build with
`pnpm --filter @gixcopilot/rag build`.

```ts
import { createRecursiveChunker, createOpenAIEmbeddingProvider, createIndexer, createRetriever, formatKnowledgeContext } from '@gixcopilot/rag';
import { createInMemoryVectorStore } from '@gixcopilot/rag';

const vectorStore = createInMemoryVectorStore(); // swap for @gixcopilot/vectorstore-pgvector in production
const embeddingProvider = createOpenAIEmbeddingProvider({ apiKey: process.env.OPENAI_API_KEY!, model: 'text-embedding-3-small' });
await createIndexer({ vectorStore, embeddingProvider, chunker: createRecursiveChunker() }).index({ source, loader });
const result = await createRetriever({ vectorStore, embeddingProvider }).retrieve({ text: 'annual leave policy' }, { securityContext });
```

`retrieve()`'s `securityContext` must come from a trusted server-side source, never model/query
input — tenant and ACL filtering both run before results are ranked or cited, and every excluded
candidate is recorded with a reason (`RetrievalDiagnostics.exclusions`). Automated tests should
use `createDeterministicEmbeddingProvider`, never a paid provider. This package never depends on
PostgreSQL/Drizzle directly — see `@gixcopilot/vectorstore-pgvector` for the production adapter.

See [Phase 9 API](../../docs/phases/phase-09/Phase_9_API.md),
[architecture](../../docs/phases/phase-09/Phase_9_Architecture.md),
[supported limits](../../docs/phases/phase-09/Phase_9_Issues.md), and
[validation](../../docs/phases/phase-09/Phase_9_Testing.md).
