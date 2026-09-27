# Knowledge and RAG

```text
source → loader → document → chunker → embeddings → vector store
query  → embeddings → candidates → TENANT + ACL filter → policies → rerank → context + citations → model
```

Permission filtering happens **before** any text reaches the model: the retriever filters by
the caller's authenticated tenant and ACL (`users`, `roles`, `permissions`, `groups`). A
query cannot override the tenant.

- Loaders (`@gixcopilot/knowledge`): text, Markdown, HTML, PDF, DOCX, web, API, database,
  object storage, MCP resources.
- `createIndexer({ chunker, embeddingProvider, vectorStore })`, `createRetriever({ vectorStore,
  embeddingProvider })`, citations (`@gixcopilot/rag`).
- Stores: in-memory (development), PostgreSQL + pgvector (`@gixcopilot/vectorstore-pgvector`,
  HNSW cosine index, tenant and metadata filters).
- Embeddings: OpenAI (`createOpenAIEmbeddingProvider`) or deterministic test embeddings (tests
  only, and labelled as such).
- Production ingestion runs in the worker: the platform's "Reindex" enqueues an idempotent
  `knowledge.index` job ([Workers](../production/WORKERS.md)).

Examples: `examples/react-rag`, `examples/evals`. ADR [0014](../adr/0014-knowledge-rag-memory-architecture.md).
