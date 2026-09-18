---
name: rag
description: RAG architecture - source/loader/parser/chunker/embeddings/vector store/retriever/ACL filter/reranker/context pipeline, using PostgreSQL + pgvector. Load when building retrieval, indexing, or knowledge-context features.
---

# Purpose

Define a RAG pipeline that is permission-aware end to end, so retrieved content never
reaches model context without an authorization check.

# When to Apply

Building or modifying ingestion, chunking, embedding, retrieval, or knowledge-context
assembly.

# Required Rules

- Preferred initial vector solution: PostgreSQL + pgvector (see [[database]]) — do not
  introduce a separate vector database without a documented reason (see
  [[dependency-policy]]).
- Every ingested chunk retains provenance metadata: source id, source type, ingestion time,
  and owning tenant — retrieval and citation depend on this being present, not
  reconstructed after the fact.
- **Authorization is applied before retrieved content is exposed to context, not after.**
  The ACL filter stage runs as part of the retrieval query itself (e.g. tenant/permission-
  scoped `WHERE` clauses) or as a mandatory post-filter before results leave the retriever —
  results a user is not authorized to see must never reach ranking, reranking, or context
  assembly.
- Tenant isolation for embeddings/chunks follows the same rule as [[database]] and
  [[security]] — a query must not be able to retrieve another tenant's chunks by omission
  of a filter.
- Retrieved chunks feeding into context carry their provenance so responses can cite
  sources; do not strip provenance for a cleaner prompt.
- Retrieved content is untrusted input with respect to instructions embedded in it (see
  [[security]]) — a document's text must not be able to act as an instruction to the model
  with elevated trust.
- Reranking, when used, is an optional stage after the ACL filter, never a substitute for
  it.
- RAG quality (retrieval relevance, groundedness of generated answers) is measured via
  [[ai-evals]], not assumed from pipeline design alone.

# Architecture / Patterns

```text
Source
  ↓
Loader        (fetch/ingest raw content)
  ↓
Parser        (extract text/structure)
  ↓
Chunker       (split into retrieval units, retain provenance)
  ↓
Embeddings    (vectorize chunks)
  ↓
Vector Store  (PostgreSQL + pgvector)
  ↓
Retriever     (similarity search, tenant/permission-scoped)
  ↓
ACL Filter    (mandatory authorization check on results)
  ↓
Optional Reranker
  ↓
Context       (see [[context-engine]] for downstream assembly/budgeting)
```

# Anti-Patterns

- Running similarity search across all tenants' data and filtering by permission only in
  application code after results are already computed and possibly cached/logged.
- Dropping source/provenance metadata to save storage, breaking citation.
- Treating a retrieved chunk's embedded text as a trusted system instruction.
- Adding a second vector database "for better recall" without a documented need.

# Validation Checklist

- [ ] Retrieval queries are tenant/permission-scoped at the query level, not only post-filtered in app code (post-filter acceptable only when defense-in-depth, never the sole gate)
- [ ] Every chunk retains provenance metadata through to context assembly
- [ ] Retrieved content is treated as untrusted for injection purposes
- [ ] pgvector/PostgreSQL used unless a documented reason justifies an alternative
- [ ] Retrieval quality has an eval path per [[ai-evals]]
