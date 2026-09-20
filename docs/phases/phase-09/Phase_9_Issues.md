# Phase 9 issues and limits

## Resolved during this review

| Finding | Resolution / evidence |
| --- | --- |
| `pnpm-workspace.yaml`'s `allowBuilds` scaffold had placeholder strings (`"set this to true or false"`) instead of booleans, so `pnpm install` hard-failed with `ERR_PNPM_IGNORED_BUILDS` and blocked every `nx` command before any Phase 9 work could be validated | Set real `true` values for `cpu-features`/`esbuild`/`nx`/`protobufjs`/`ssh2` — all widely-used, low-risk packages pulled in transitively by `testcontainers`; `pnpm install` now succeeds |
| `@gixcopilot/memory` was empty scaffolding only (`package.json`/`tsconfig.json`/`vitest.config.ts`, zero source files) — the entire memory architecture (Section 87-114) was unimplemented | Built the full package: record model, `MemoryStore` contract, in-memory and vector-backed implementations, owner/tenant security, write policy, retention, `MemoryService`, Context Engine integration; 64 tests |
| `createPgVectorStore.search()`'s threshold condition, `(1 - ${distance})`, embedded pgvector's `<=>` operator without inner parentheses; Postgres parsed it as `(1 - "embedding") <=> $vector` (integer minus vector) instead of `1 - ("embedding" <=> $vector)`, throwing `operator does not exist: integer - vector` | Parenthesized the reused distance expression explicitly (`(1 - (${distance}))`); caught by a genuine Testcontainers-backed integration test, confirmed fixed by rerunning it against real Postgres |
| `knowledge`'s `web.ts` streaming byte-limit check destructured `reader.read()`'s result with no type annotation; under this repo's DOM-less `lib` configuration the expression resolved to an unchecked/unresolvable type, failing three `no-unsafe-*` lint rules | Introduced a minimal local `StreamChunk` shape and cast through it, rather than relying on an ambient `ReadableStreamReadResult` this tsconfig does not provide |
| `examples/react-rag`'s test suite imported `createToolCallingExecutor`/`createFrontendToolBridge` from `@gixcopilot/server`, but neither was exported from its public `index.ts` (both existed and were already tested internally) | Promoted both to `@gixcopilot/server`'s public API, matching the existing pattern of exposing real internal building blocks (`createRunRegistry`, `formatSseFrame`) |
| No `docs/phases/phase-09/` directory existed at all, despite a substantial knowledge/rag/pgvector implementation already present | Wrote all ten required documents plus ADR 0014, informed by re-reading the actual implementation and re-running every check rather than restating unverified claims |

## Deliberate scope decisions

- **No `useKnowledgeSources()`/`useMemory()` React hook was added** to the public SDK surface.
  Section 124 lists them as "potential," conditioned on "only add APIs justified by
  implementation." Nothing in this phase gives the browser a live, general-purpose knowledge-
  source listing or memory CRUD channel independent of an application's own backend routes (the
  `react-rag` example demonstrates memory save/view/forget entirely through its own Fastify
  routes plus plain `fetch`, which needs no shared package hook). `useCitations()` *was* added
  because Section 75's citation UI is a direct, concrete requirement with real data to render.
  Adding speculative hooks with no live data source now would be exactly the "public API
  explosion" Section 124 warns against; a future phase can add them once a concrete transport
  for that data exists.
- **No new protocol/SSE event type for citations or memory.** They reach the browser as ordinary
  JSON from the example's own routes, not a `Message`/`ContentPart`/event-shape change — keeping
  Phase 9 fully additive to every earlier phase's wire contract (see
  [Implementation](Phase_9_Implementation.md)).
- **The in-memory vector store remains the default for the example's knowledge base**; only the
  real-provider `smoke.ts` path uses `createPgVectorStore`. This matches Section 42's "not a
  production recommendation" framing and keeps the normal (free, fast) test suite
  infrastructure-free.
- **A natural-language-to-SQL database knowledge source was not implemented** (Section 22
  explicitly excludes it); `createDatabaseKnowledgeSource`/`databaseLoader` take only a
  predefined, host-supplied safe query.
- **No S3/Azure Blob/GCS-specific adapter was implemented**; `objectStorageSource`/
  `objectStorageLoader` depend only on a generic `{ list, get }` client shape the host supplies
  (Section 23: "do not implement every vendor unless justified").

## Supported limits

- **Vector search is Testcontainers-verified but process-local at the application layer.**
  `createPgVectorStore` opens its own connection pool per call; a multi-process host shares one
  the same way it already shares any other database connection — no pooling/scheduling
  infrastructure beyond `pg.Pool` is provided.
- **Reranking ships one baseline** (`createSimilarityReranker`); the `Reranker` interface
  supports a cross-encoder/LLM/provider reranker, but none is implemented here (Section 68: "do
  not make reranking mandatory").
- **Hybrid (keyword + vector) search is not implemented.** `VectorStore` does not preclude it,
  but building it was out of scope for Phase 9 (Section 137: "do not make it mandatory if it
  bloats Phase 9").
- **Query rewriting/expansion is not implemented**; retrieval is deterministic given the query
  text as supplied (Section 136).
- **Memory's default per-type retention (working: 1h, session: 24h, durable/semantic: 90d) is a
  documented default, not a regulatory-compliance-grade retention policy** — an explicit
  `expiresAt` always overrides it, and `createMemoryService`'s persistence gate/audit are the
  mandatory floor, not a full consent-management product (Section 101/123: "provide SDK
  primitives/headless APIs," not an account settings platform).
- **`createMemoryService`'s audit is best-effort** (an `AuditSink` write failure does not block
  the underlying memory operation) — the same tradeoff Phase 7's audit sink already makes.
- **The example's knowledge base and identities are local test fixtures** (three static Markdown
  documents, five hardcoded viewer/supervisor/admin identities via `Authorization: Bearer <role>`)
  — not production authentication or a real document corpus.
- **The real-provider smoke test requires the caller to provision and tear down its own disposable
  Postgres** (`RAG_SMOKE_DATABASE_URL`); it does not manage that infrastructure itself.

Phase 10+ remains locked. Agents, multi-agent orchestration, a DevTools platform, Angular, and an
enterprise management platform are planned phases, not Phase 9 technical debt.
