# ADR 0014: Knowledge, RAG and memory architecture

Status: accepted for Phase 9.

## Context

The SDK needs enterprise knowledge retrieval (files, documents, web content, databases, APIs,
object storage, MCP resources) and an explicit memory architecture (working, session, durable,
semantic — kept distinct from conversation history and from RAG), both feeding the model, without
creating a second context-assembly engine or a second authorization model alongside Phase 4's
`ContextEngine` and Phase 7's `SecurityContext`/Action Firewall/data policy.

## Decision

Four packages: `@gixcopilot/knowledge` (source/document/loader/parser contracts; depends only on
protocol + Phase 8's `mcp`), `@gixcopilot/rag` (chunking, embeddings, the storage-agnostic
`VectorStore` contract, permission-aware retrieval, reranking, citations; depends on protocol +
security + knowledge, never on PostgreSQL), `@gixcopilot/vectorstore-pgvector` (the only package
depending on `drizzle-orm`/`pg`; implements `VectorStore` against two logically separate table
sets selected by a `table: 'knowledge' | 'memory'` option), and `@gixcopilot/memory` (working/
session/durable/semantic memory; depends on protocol + security + rag, reusing rag's
`EmbeddingProvider`/`VectorStore` for semantic memory in a separate table rather than a second,
incompatible vector system).

Retrieval and memory both produce plain, duck-typed context contributions
(`formatKnowledgeContext`, `formatMemoryContext`) that a host registers into the real
`ContextEngine` — neither package imports `@gixcopilot/context`. Knowledge contributions register
at `'high'` priority; memory is fixed at `'normal'`, one tier below every `'critical'` system
instruction, so durable memory structurally cannot outrank the current explicit instruction or
trusted system prompt.

Permission-aware retrieval enforces tenant/ACL restrictions as a real SQL pre-filter in the
pgvector adapter (before `LIMIT`) and again as an application-level post-filter in the retriever
(defense in depth); ABAC policies and data-policy redaction run afterward, before reranking and
citation assignment. Memory ownership (`user`/`session`/`tenant`/`workspace`/`application`) is
mandatory on every record, derived only from a trusted `SecurityContext`, and asserted on every
read/write on top of each store's own owner/tenant-scoped query. A credential-shaped memory value
is rejected by default before it reaches storage; `createMemoryService` additionally requires
explicit per-write confirmation (or an application-configured policy) plus an audit record.

`@gixcopilot/react`/`@gixcopilot/ui` do not depend on `rag`/`memory`. Citation
(`useCitations`, `<Citation />`/`<CitationList />`/`<SourcePreview />`) and memory UI are
duck-typed against plain data shapes the host application supplies, since retrieval and
authorization already happened server-side by the time anything reaches the browser.

`createToolCallingExecutor`/`createFrontendToolBridge` — real, already-tested internals
`createServer` already composed — were promoted to `@gixcopilot/server`'s public API so a host
(here, the `react-rag` example's prompt-injection regression) can run the Model → Tool → Model
loop directly against the Action Firewall without a full HTTP/SSE round trip.

## Alternatives and consequences

- A second, RAG-owned context/prompt-construction path was rejected; RAG and memory are producers
  into the one existing Context Engine, never a competing one.
- Enforcing tenant/ACL only in application code (post-filter only) was rejected: it would retrieve
  unauthorized rows into process memory unnecessarily and rely on a single layer for a security
  boundary. Both a real SQL pre-filter and a post-filter run, matching the database skill's
  "a vector index is a performance optimization, never the security boundary" rule.
- Reusing `KnowledgeACL`'s exact shape for memory ownership was rejected: memory's owner model
  (a single mandatory owner) is a different, simpler concept than knowledge's ACL (optional,
  multi-principal grants), so memory has its own `MemoryOwner` type rather than overloading one
  model for two different security concepts.
- Letting the model decide what becomes durable memory with no gate was rejected (Section 100);
  `createMemoryService`'s explicit-confirmation default and the credential write-policy are the
  mandatory floor, with room for a stricter or looser application-supplied policy.
- A natural-language-to-SQL database knowledge source was explicitly out of scope; the database
  loader takes only a predefined, host-supplied safe query.
- Full vendor coverage for object storage (S3/Azure/GCS-specific SDKs) was rejected as
  premature; the loader depends only on a generic `{ list, get }` client shape the host supplies.

Evidence: [Phase 9 testing](../phases/phase-09/Phase_9_Testing.md),
[API](../phases/phase-09/Phase_9_API.md), [limitations](../phases/phase-09/Phase_9_Issues.md).
