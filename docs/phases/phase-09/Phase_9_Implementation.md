# Phase 9 implementation

The session inherited a substantial in-progress draft (knowledge, rag, and vectorstore-pgvector
packages with real loaders, a permission-aware retriever, and a pgvector adapter with SQL-level
ACL filtering already implemented) but an entirely empty `@gixcopilot/memory` package (scaffolding
only — `package.json`/`tsconfig.json`/`vitest.config.ts`, zero source files), no Context Engine
citation/memory wiring in `@gixcopilot/react`/`@gixcopilot/ui`, no `examples/react-rag`, no
`docs/phases/phase-09/`, and a broken `pnpm-workspace.yaml` that hard-failed `pnpm install` (see
[Issues](Phase_9_Issues.md)). This review completed:

- Fixed `pnpm-workspace.yaml`'s `allowBuilds` scaffold (placeholder strings instead of booleans),
  which made every `pnpm install`/`nx` command fail before any Phase 9 work could even be
  validated.
- Built `@gixcopilot/memory` from scratch: `MemoryRecord`/`MemoryOwner`/`MemoryType`, the
  `MemoryStore` contract, `createInMemoryMemoryStore`, `createVectorBackedMemoryStore` (against
  rag's `VectorStore`), owner/tenant security (`assertMemoryAccess`,
  `ownerFromSecurityContext`), a default credential-detecting write policy, per-type retention
  defaults, `createMemoryService` (explicit-confirmation persistence + audit), and
  `formatMemoryContext` for Context Engine integration.
- Found and fixed a real SQL operator-precedence bug in `createPgVectorStore.search()`: the
  threshold condition `(1 - ${distance})` embedded pgvector's `<=>` operator without inner
  parentheses, so Postgres parsed it as `(1 - "embedding") <=> $vector` (integer minus vector,
  a runtime SQL error) instead of `1 - ("embedding" <=> $vector)`. Caught by a genuine
  Testcontainers-backed integration test, not assumed.
- Found and fixed an unresolved-type lint failure in `knowledge`'s `web.ts` streaming byte-limit
  check (`ReadableStreamReadResult` is not ambiently available under this repo's DOM-less `lib`
  configuration); replaced with a minimal local shape.
- Promoted `createToolCallingExecutor`/`createFrontendToolBridge` from `@gixcopilot/server`'s
  internal modules to its public `index.ts` (they were already fully implemented and tested —
  `createServer` already composes them internally; the `react-rag` example's prompt-injection
  regression needed to run the executor directly, in-process, against the Action Firewall
  without a full HTTP/SSE round trip).
- Added `@gixcopilot/react`'s `useCitations` and `@gixcopilot/ui`'s `<Citation />`/
  `<CitationList />`/`<SourcePreview />`, duck-typed against a plain `CitationData` shape with no
  dependency on `@gixcopilot/rag` (the package-boundary rule below).
- Built `examples/react-rag`: three permission-tiered knowledge documents (public handbook,
  supervisor guide, admin security procedure with a secret rotation code), a `RagService`
  wiring retrieval + memory + the real Context Engine + the real AI runtime, Fastify routes for
  chat and explicit memory save/view/forget, a browser UI, an integration test suite covering
  every Section 149-172 "TEST —" requirement that does not need a paid API, and a `smoke.ts`
  real-provider script.
- Wrote all ten Phase 9 documents and the ADR below.

## Dependency review

| Dependency | Installed version / license | Use and boundary |
| --- | --- | --- |
| `pdfjs-dist` | 4.10.38 / Apache-2.0 | PDF text/page extraction (`knowledge`'s `pdf` loader) |
| `mammoth` | 1.12.3 / BSD-2-Clause | DOCX → structured text (`knowledge`'s `docx` loader) |
| `node-html-parser` | 7.1.0 / MIT | HTML parsing/structure extraction (`knowledge`'s `html`/`web` loaders) |
| `jszip`, `pdf-lib` | 3.10.2 (MIT OR GPL-3.0-or-later), 1.17.1 / MIT | devDependencies only — generate real `.docx`/`.pdf` test fixtures, never shipped |
| `openai` | 7.19.0 / Apache-2.0 | `rag`'s real embedding provider (`createOpenAIEmbeddingProvider`); the same official SDK Phase 2's `@gixcopilot/provider-openai` already vetted, used directly here since embeddings are a distinct API surface from chat completion |
| `drizzle-orm`, `pg` | 0.44.7 / Apache-2.0, 8.23.0 / MIT | `vectorstore-pgvector`'s schema/query layer — confined to this one package, per the database skill's "no PostgreSQL dependency in core RAG abstractions" rule |
| `drizzle-kit` | 0.31.10 / MIT | devDependency — generates `migrations/0000_init.sql` from `schema.ts`; not a runtime dependency |
| `@types/pg` | 8.23.1 / MIT | devDependency — type-only |
| `testcontainers`, `@testcontainers/postgresql` | 12.1.0 / MIT | devDependencies — real Postgres+pgvector integration tests, auto-skipped when Docker is unreachable, matching the OpenAPI/MCP phase's precedent of preferring real integration coverage over mocks for a genuinely new storage dependency |

Versions/licenses were read from each installed package's own `package.json` in the pnpm store,
not assumed. All are permissive (Apache-2.0/MIT/BSD-2-Clause); `jszip`'s GPL alternative does not
apply since it is dual-licensed and used only as a devDependency. No dependency was added to
`@gixcopilot/react`, `@gixcopilot/ui`, or any package a browser bundle pulls in. This review is
not a dependency vulnerability audit.

## Protocol changes

Additive only, following the same pattern as every prior phase's error-taxonomy extension:
`CopilotErrorCode` gained `SOURCE_LOAD_FAILED`, `PARSE_FAILED`, `CHUNK_FAILED`,
`EMBEDDING_FAILED`, `VECTOR_STORE_FAILED`, `INDEX_FAILED`, `RETRIEVAL_FAILED`,
`MEMORY_WRITE_DENIED`, `MEMORY_READ_DENIED` (Section 129), each with a `CopilotError.xFailed(...)`
factory. ACL/tenant denial deliberately reuses the existing `PERMISSION_DENIED`/`TENANT_MISMATCH`
codes rather than adding a duplicate `ACCESS_DENIED` for the same failure class. No `Message`,
`ContentPart`, `Run`, or event shape changed — citations and memory reach the client as ordinary
JSON from `examples/react-rag`'s own Fastify routes, not a new protocol/SSE event type, keeping
Phase 9 additive to every earlier phase's wire contract.

No deployment, publishing, or commits were performed. See [Files](Phase_9_Files.md) for the
complete change inventory.
