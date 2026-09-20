# Phase 9 decisions

[ADR 0014](../../adr/0014-knowledge-rag-memory-architecture.md) owns the knowledge/RAG/memory
architecture. Headline decisions:

1. Four new packages, in a strict dependency chain (`knowledge` → `rag` → `vectorstore-pgvector`,
   and `memory` → `rag`), enforced by `eslint.config.js`'s boundary rules — never a cycle, and
   never a PostgreSQL/Drizzle dependency outside `vectorstore-pgvector`.
2. RAG and memory both register plain, duck-typed `ContextContribution`s into the *existing*
   Phase 4 `ContextEngine` rather than building a second prompt-construction/budget system.
   Neither `rag` nor `memory` imports `@gixcopilot/context` at all.
3. Permission-aware retrieval reuses Phase 7's `SecurityContext`/`Policy`/`DataPolicy` directly —
   never a second identity or authorization model. ACL/tenant filtering runs as a real SQL
   pre-filter in the pgvector adapter *and* as an application-level post-filter in the retriever
   (defense in depth); a malformed ACL shape fails closed.
4. `@gixcopilot/vectorstore-pgvector`'s `VectorStore` implementation is generic over a table set
   (`knowledge_chunks` vs. `memory_embeddings`); `@gixcopilot/memory`'s `createVectorBackedMemoryStore`
   is what points a `VectorStore` instance at the memory table, keeping memory and knowledge
   storage logically separate without a second storage interface (Section 179).
5. Memory ownership (`user`/`session`/`tenant`/`workspace`/`application`) is mandatory on every
   record and is derived only from a trusted `SecurityContext`, never from model/query input.
   Every read/write asserts owner + tenant match, on top of each store's own scoped query.
6. Durable memory is capped at `'normal'` context priority, structurally below every `'critical'`
   system instruction and below the live user turn (which is not a context item at all) — "the
   current explicit instruction wins" (Section 109) falls out of the priority model rather than
   needing its own runtime string-comparison logic.
7. A credential-shaped write is rejected by default (`createDefaultMemoryWritePolicy`) before it
   reaches any store, and `createMemoryService` requires explicit per-write confirmation (or an
   application-configured policy) plus an audit record — "the model decided this looked useful"
   is never sufficient on its own to persist something durably.
8. `@gixcopilot/react`/`@gixcopilot/ui` do not depend on `rag`/`memory`; citation and memory UI
   are duck-typed against plain data the host application supplies, since retrieval/authorization
   already happened server-side before anything reaches the browser.
9. `createToolCallingExecutor`/`createFrontendToolBridge` were promoted from
   `@gixcopilot/server`'s internal modules to its public API — real, already-tested primitives
   `createServer` already composed internally, needed by the example to prove prompt-injection
   containment without a full HTTP/SSE round trip. This is the same "expose a real internal
   building block" pattern as `createRunRegistry`/`formatSseFrame`, not a new abstraction.
10. Test embeddings are always deterministic (`createDeterministicEmbeddingProvider`); real
    OpenAI embeddings and a real Postgres+pgvector database are exercised through an explicit,
    separately invoked smoke script, never a required part of the normal test suite.

Standards consulted: the existing `docs/architecture/overview.md` dependency-direction rule, the
`database` skill's "vector index is a performance optimization, never the security boundary"
rule, and [pgvector's HNSW indexing documentation](https://github.com/pgvector/pgvector). The
implementation documents its supported subset (see [Issues](Phase_9_Issues.md)) rather than
claiming a general-purpose RAG framework.
