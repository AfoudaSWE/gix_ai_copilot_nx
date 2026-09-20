# Phase 9 completion report

```
AI COPILOT SDK
PHASE 09 — KNOWLEDGE + RAG + MEMORY


STATUS

COMPLETE


PREVIOUS PHASE REGRESSION

Phase 1:
PASS

Phase 2:
PASS

Phase 3:
PASS

Phase 4:
PASS

Phase 5:
PASS

Phase 6:
PASS

Phase 7:
PASS

Phase 8:
PASS


KNOWLEDGE

Source abstraction and registry:
PASS

Document model and identity:
PASS

Source provenance:
PASS

Loaders (text, markdown, PDF, DOCX, HTML/web, API, database, object storage, MCP resource):
PASS

SSRF-safe web loading:
PASS

Normalization:
PASS

Chunk model and deterministic chunk IDs:
PASS

Structure-aware chunking:
PASS


RAG

Embedding abstraction:
PASS

Real OpenAI embeddings:
PASS

Deterministic test embeddings:
PASS

Embedding batching and rate-limit retry:
PASS

Vector store abstraction:
PASS

In-memory vector store:
PASS

PostgreSQL + pgvector adapter:
PASS

Indexing, reindexing, deletion:
PASS

Permission-aware retrieval (tenant + ACL + ABAC):
PASS

Top-K, similarity threshold, metadata filters:
PASS

Reranking abstraction:
PASS

Citations and provenance:
PASS

Citation validation (unknown-ID detection):
PASS

Retrieval diagnostics:
PASS


MEMORY

Memory taxonomy (working, session, durable, semantic; distinct from conversation history):
PASS

Memory record and ownership model:
PASS

In-memory store:
PASS

Vector-backed (persistent, semantic) store:
PASS

Memory security (owner + tenant assertion):
PASS

Sensitive-memory write policy:
PASS

Memory expiration:
PASS

Memory deletion:
PASS

Memory update semantics (replace/merge):
PASS

Explicit persistence consent + audit (MemoryService):
PASS

Current-instruction-wins precedence:
PASS


UNIFIED ARCHITECTURE

RAG and memory both register into the one existing Phase 4 ContextEngine:
PASS

No second prompt-construction engine (rag/memory never import @gixcopilot/context):
PASS

Both reuse Phase 7's SecurityContext/Policy/DataPolicy (no second authorization model):
PASS

React/UI citation components depend on plain data, not on rag/memory packages:
PASS


SECURITY

Tenant isolation (knowledge and memory):
PASS

ACL enforcement (SQL pre-filter + application post-filter):
PASS

PII / data policy applied after authorization:
PASS

Prompt injection containment (retrieved/remembered content is data, never instructions):
PASS

No unauthorized content ever reaches the model (viewer/admin critical test):
PASS

MCP resource ingestion uses the identical tenant/ACL pipeline:
PASS


REAL MODEL VALIDATION

Flow:
Question -> real OpenAI embedding -> pgvector -> permission filter -> real ContextEngine ->
real OpenAI (gpt-4o-mini) -> cited answer

Result:
PASS (see docs/phases/phase-09/real-smoke.json)

Viewer denied restricted (admin-only) answer:
PASS

Admin receives authorized restricted answer:
PASS

Current explicit Arabic instruction overrides saved English memory preference:
PASS

Explicit memory deletion:
PASS

This flow was actually executed against a real OpenAI API key and a real, disposable
PostgreSQL 16 + pgvector container this session - not assumed, not left "NOT RUN."


TEST RESULTS

Fresh, no-cache `nx run-many -t lint,typecheck,test,build` across all 32 workspace projects:
32/32 lint clean, 32/32 typecheck clean, 32/32 build clean, 32/32 test clean.

996 tests passed, 4 skipped, 1,000 total, zero failures.

The 4 skips are pre-existing, correctly-gated optional real-provider smoke suites from earlier
phases (require OPENAI_API_KEY / RUN_OPENAI_SMOKE=1). Phase 9's own new/touched test files:

knowledge: 78 tests (17 files)
rag: 82 tests (11 files)
vectorstore-pgvector: 11 tests (1 file, real Postgres via Testcontainers)
memory: 64 tests (7 files)
react (citation-hooks): included in react's 39
ui (citations): included in ui's 26
react-rag (example): 6 tests (1 file)


PERFORMANCE

Reproducible source: examples/react-rag/src/smoke.ts, run with a real OpenAI key and a
disposable Postgres. Raw measurements: docs/phases/phase-09/real-smoke.json. One local run
against real network calls, not a throughput/load-test claim.

Chunking (per document):
0.08-0.50 ms

Real embedding, 1-3 chunks batched:
207-452 ms

pgvector upsert:
8-12 ms

Real query embedding:
237-483 ms

pgvector similarity search:
4.5-105 ms

Reranking (baseline similarity reranker):
under 0.05 ms

Memory semantic search:
208-299 ms

Context resolution (real ContextEngine):
0.06-0.78 ms


DEPENDENCIES ADDED

pdfjs-dist 4.10.38 (Apache-2.0), mammoth 1.12.3 (BSD-2-Clause), node-html-parser 7.1.0 (MIT) -
knowledge loaders. jszip 3.10.2, pdf-lib 1.17.1 (devDependencies, test fixtures only). openai
7.19.0 (Apache-2.0) - real embeddings. drizzle-orm 0.44.7 (Apache-2.0), pg 8.23.0 (MIT) -
vectorstore-pgvector only. drizzle-kit 0.31.10, @types/pg 8.23.1, testcontainers 12.1.0,
@testcontainers/postgresql 12.1.0 (devDependencies). No dependency was added to
@gixcopilot/react, @gixcopilot/ui, or any browser-bundled package.


PROTOCOL CHANGES

Additive only: CopilotErrorCode gained SOURCE_LOAD_FAILED, PARSE_FAILED, CHUNK_FAILED,
EMBEDDING_FAILED, VECTOR_STORE_FAILED, INDEX_FAILED, RETRIEVAL_FAILED, MEMORY_WRITE_DENIED,
MEMORY_READ_DENIED, each with a CopilotError.xFailed(...) factory. No Message, ContentPart,
Run, or event shape changed.


PUBLIC APIS

@gixcopilot/knowledge: createKnowledgeSourceRegistry, per-type source constructors
(textSource/pdfSource/docxSource/htmlSource/webSource/apiSource/
createDatabaseKnowledgeSource/objectStorageSource/mcpResourceSource/fileSource/customSource),
per-type loaders, defaultKnowledgeLoaders, assertSafeWebUrl.

@gixcopilot/rag: createRecursiveChunker, createDeterministicEmbeddingProvider,
createOpenAIEmbeddingProvider, createInMemoryVectorStore, createIndexer, createRetriever,
createSimilarityReranker, assignCitationIds, validateCitations, formatKnowledgeContext,
citationsForContext, measureKnowledge.

@gixcopilot/vectorstore-pgvector: createPgVectorStore (table: 'knowledge' | 'memory').

@gixcopilot/memory: createInMemoryMemoryStore, createVectorBackedMemoryStore,
assertMemoryAccess, ownerFromSecurityContext, createDefaultMemoryWritePolicy,
createMemoryService, formatMemoryContext.

@gixcopilot/react: useCitations. @gixcopilot/ui: Citation, CitationList, SourcePreview.

@gixcopilot/server: createToolCallingExecutor, createFrontendToolBridge (promoted from
internal-only to public - see Architecture Decisions).

Full signatures: docs/phases/phase-09/Phase_9_API.md.


ARCHITECTURE DECISIONS

See ADR 0014 and Phase 9 Decisions for the full record. Headline decisions: four packages in a
strict, eslint-enforced dependency chain with no cycle and no PostgreSQL dependency outside
vectorstore-pgvector; RAG and memory both register plain, duck-typed contributions into the
existing Phase 4 ContextEngine rather than building a second one; permission-aware retrieval
reuses Phase 7's SecurityContext/Policy/DataPolicy directly; ACL/tenant filtering runs as a real
SQL pre-filter and again as an application-level post-filter (defense in depth); memory
ownership is mandatory and derived only from a trusted SecurityContext; durable memory is fixed
at 'normal' context priority so it can never outrank a 'critical' system instruction or the
current user turn; a credential-shaped memory write is rejected by default, and
createMemoryService requires explicit confirmation plus an audit record before anything
persists; React/UI citation components are duck-typed against plain data, with no
react/ui -> rag/memory dependency.


FILES CREATED

146 new files across `packages/knowledge/`, `packages/rag/`, `packages/vectorstores/pgvector/`,
`packages/memory/`, `examples/react-rag/`, plus `packages/react/src/citation-hooks.{ts,spec.
tsx}`, `packages/ui/src/citations.{tsx,spec.tsx}`, `docs/adr/0014-*.md`, and all 10
`docs/phases/phase-09/Phase_9_*.md` files plus `docs/phases/phase-09/real-smoke.json` - see
Phase 9 Files for the complete, exact list.


FILES MODIFIED

`docs/CHANGELOG_PHASES.md`, `docs/DECISIONS.md`, `docs/PROJECT_STATUS.md`,
`docs/TECHNICAL_DEBT.md`, `docs/architecture/overview.md`, `eslint.config.js`,
`packages/protocol/src/errors.{ts,spec.ts}` (additive error codes), `packages/react/src/
index.ts` (useCitations export), `packages/server/src/index.ts` (promoted executor/bridge
exports), `packages/ui/src/index.ts` (citation component exports), `pnpm-lock.yaml`,
`pnpm-workspace.yaml` (fixed a broken install-blocking scaffold), `tools/vitest.shared.ts`,
`tsconfig.json`. See Phase 9 Files for the complete list.


COMMITS

None. No commit was requested or created this phase.


ISSUES

Real issues found and fixed during this review (all fixed within this phase, none carried
forward as debt) - see Phase 9 Issues for the complete, itemized list with resolutions.
Highlights: a broken pnpm-workspace.yaml scaffold that hard-failed `pnpm install` and blocked
every nx command; @gixcopilot/memory was entirely unimplemented scaffolding; a real SQL
operator-precedence bug in pgvector's search() threshold condition, caught by a genuine
Testcontainers-backed integration test and confirmed fixed by rerunning it against real
Postgres; an unresolved-type lint failure in knowledge's web.ts streaming byte-limit check;
two real internal server primitives (createToolCallingExecutor, createFrontendToolBridge)
needed for the example's prompt-injection regression were not exported publicly.


TECHNICAL DEBT

No new debt category was introduced - see the Phase 9 entry in `docs/TECHNICAL_DEBT.md` and
Phase 9 Issues's "Supported limits" section for the honest, explicit boundary (one baseline
reranker with an extension point but no cross-encoder/LLM reranker implemented; no hybrid
keyword+vector search; no query rewriting; bounded default memory retention rather than a
compliance-grade retention product; no S3/Azure/GCS-specific object-storage adapter; no
natural-language-to-SQL database source - all explicitly out of Phase 9's scope, not deferred
work masquerading as debt).


DOCUMENTATION

Phase_9_Docs:
PASS

Phase_9_Architecture:
PASS

Phase_9_Implementation:
PASS

Phase_9_Status:
PASS

Phase_9_Testing:
PASS

Phase_9_Decisions:
PASS

Phase_9_API:
PASS

Phase_9_Files:
PASS

Phase_9_Issues:
PASS

Phase_9_Handoff:
PASS
```

## Notes on this report

This report was compiled after independently re-verifying every claim above, in this same
session:

- A fresh, no-cache `nx run-many` for `lint`/`typecheck`/`test`/`build` was re-run directly by
  the reporting session (not merely re-stated from an earlier pass): 32/32 projects lint clean,
  32/32 typecheck clean, 32/32 build clean, 32/32 test clean — **996 tests passed, 4 skipped,
  1,000 total, zero failures**.
- The real-model flow was independently re-run with a real `OPENAI_API_KEY` (read via
  `--env-file`, never echoed or committed) and a genuinely provisioned, disposable
  `pgvector/pgvector:pg16` Docker container (migrated, used, and torn down within this session) —
  confirmed to pass for real, with an actual OpenAI chat completion and actual embedding calls,
  not prompt-matched or simulated. The raw report is committed at
  [real-smoke.json](real-smoke.json).
- Two genuine defects were found by this verification, not merely inherited from the draft: the
  pgvector operator-precedence bug (caught only because the real Postgres+Testcontainers
  integration test was actually executed rather than left "typechecked but not run") and the
  `pnpm-workspace.yaml` scaffold that blocked `pnpm install` outright. Both are fixed and
  reverified in isolation and as part of the full suite above.
- `packages/vectorstores/pgvector/src/pg-vector-store.integration.spec.ts` and
  `examples/react-rag/src/service.spec.ts` were each run in isolation and confirmed passing, in
  addition to the full workspace run.

See [Phase 9 Testing](Phase_9_Testing.md) for exact commands, durations, and the full evidence
table.
