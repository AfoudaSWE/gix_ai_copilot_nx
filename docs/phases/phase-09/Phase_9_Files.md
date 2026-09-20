# Phase 9 files

Includes the pre-existing Phase 9 draft (knowledge/rag/vectorstore-pgvector) and this completion
review (memory, React/UI citation UI, the example, and all documentation). Generated
`dist`/`web-dist` build outputs, `node_modules`, `.tsbuildinfo`, and `.env` (gitignored) are
excluded; `.env.example` is included.

## Added

- `docs/adr/0014-knowledge-rag-memory-architecture.md`
- `docs/phases/phase-09/Phase_9_API.md`
- `docs/phases/phase-09/Phase_9_Architecture.md`
- `docs/phases/phase-09/Phase_9_Decisions.md`
- `docs/phases/phase-09/Phase_9_Docs.md`
- `docs/phases/phase-09/Phase_9_Files.md`
- `docs/phases/phase-09/Phase_9_Handoff.md`
- `docs/phases/phase-09/Phase_9_Implementation.md`
- `docs/phases/phase-09/Phase_9_Issues.md`
- `docs/phases/phase-09/Phase_9_Status.md`
- `docs/phases/phase-09/Phase_9_Testing.md`
- `docs/phases/phase-09/real-smoke.json`
- `docs/prompts/Phase_9_Prompt.md`
- `examples/react-rag/.env.example`
- `examples/react-rag/README.md`
- `examples/react-rag/index.html`
- `examples/react-rag/knowledge/admin.md`
- `examples/react-rag/knowledge/handbook.md`
- `examples/react-rag/knowledge/supervisor.md`
- `examples/react-rag/package.json`
- `examples/react-rag/project.json`
- `examples/react-rag/src/backend.ts`
- `examples/react-rag/src/knowledge.ts`
- `examples/react-rag/src/main.tsx`
- `examples/react-rag/src/server.ts`
- `examples/react-rag/src/service.spec.ts`
- `examples/react-rag/src/service.ts`
- `examples/react-rag/src/smoke.ts`
- `examples/react-rag/src/styles.css`
- `examples/react-rag/tsconfig.json`
- `examples/react-rag/vite.config.ts`
- `examples/react-rag/vitest.config.ts`
- `packages/knowledge/README.md`
- `packages/knowledge/package.json`
- `packages/knowledge/project.json`
- `packages/knowledge/src/acl.ts`
- `packages/knowledge/src/document.spec.ts`
- `packages/knowledge/src/document.ts`
- `packages/knowledge/src/index.ts`
- `packages/knowledge/src/loader.ts`
- `packages/knowledge/src/loaders/api.spec.ts`
- `packages/knowledge/src/loaders/api.ts`
- `packages/knowledge/src/loaders/database.spec.ts`
- `packages/knowledge/src/loaders/database.ts`
- `packages/knowledge/src/loaders/docx.spec.ts`
- `packages/knowledge/src/loaders/docx.ts`
- `packages/knowledge/src/loaders/file.spec.ts`
- `packages/knowledge/src/loaders/file.ts`
- `packages/knowledge/src/loaders/html-structure.spec.ts`
- `packages/knowledge/src/loaders/html-structure.ts`
- `packages/knowledge/src/loaders/html.spec.ts`
- `packages/knowledge/src/loaders/html.ts`
- `packages/knowledge/src/loaders/markdown.spec.ts`
- `packages/knowledge/src/loaders/markdown.ts`
- `packages/knowledge/src/loaders/mcp-resource.spec.ts`
- `packages/knowledge/src/loaders/mcp-resource.ts`
- `packages/knowledge/src/loaders/object-storage.spec.ts`
- `packages/knowledge/src/loaders/object-storage.ts`
- `packages/knowledge/src/loaders/pdf.spec.ts`
- `packages/knowledge/src/loaders/pdf.ts`
- `packages/knowledge/src/loaders/text.spec.ts`
- `packages/knowledge/src/loaders/text.ts`
- `packages/knowledge/src/loaders/web.spec.ts`
- `packages/knowledge/src/loaders/web.ts`
- `packages/knowledge/src/net/ssrf-guard.spec.ts`
- `packages/knowledge/src/net/ssrf-guard.ts`
- `packages/knowledge/src/normalize.spec.ts`
- `packages/knowledge/src/normalize.ts`
- `packages/knowledge/src/registry.spec.ts`
- `packages/knowledge/src/registry.ts`
- `packages/knowledge/src/source.spec.ts`
- `packages/knowledge/src/source.ts`
- `packages/knowledge/src/types/mammoth.d.ts`
- `packages/knowledge/tsconfig.json`
- `packages/knowledge/vitest.config.ts`
- `packages/memory/README.md`
- `packages/memory/package.json`
- `packages/memory/project.json`
- `packages/memory/src/context.spec.ts`
- `packages/memory/src/context.ts`
- `packages/memory/src/in-memory-store.spec.ts`
- `packages/memory/src/in-memory-store.ts`
- `packages/memory/src/index.ts`
- `packages/memory/src/record.spec.ts`
- `packages/memory/src/record.ts`
- `packages/memory/src/retention.ts`
- `packages/memory/src/security-regression.spec.ts`
- `packages/memory/src/security.spec.ts`
- `packages/memory/src/security.ts`
- `packages/memory/src/service.ts`
- `packages/memory/src/store.ts`
- `packages/memory/src/vector-backed-store.spec.ts`
- `packages/memory/src/vector-backed-store.ts`
- `packages/memory/src/write-policy.spec.ts`
- `packages/memory/src/write-policy.ts`
- `packages/memory/tsconfig.json`
- `packages/memory/vitest.config.ts`
- `packages/rag/README.md`
- `packages/rag/package.json`
- `packages/rag/project.json`
- `packages/rag/src/chunk.spec.ts`
- `packages/rag/src/chunk.ts`
- `packages/rag/src/chunker.spec.ts`
- `packages/rag/src/chunker.ts`
- `packages/rag/src/citations.spec.ts`
- `packages/rag/src/citations.ts`
- `packages/rag/src/context.spec.ts`
- `packages/rag/src/context.ts`
- `packages/rag/src/embeddings/deterministic.spec.ts`
- `packages/rag/src/embeddings/deterministic.ts`
- `packages/rag/src/embeddings/embedding-provider.ts`
- `packages/rag/src/embeddings/openai.spec.ts`
- `packages/rag/src/embeddings/openai.ts`
- `packages/rag/src/in-memory-vectorstore.spec.ts`
- `packages/rag/src/in-memory-vectorstore.ts`
- `packages/rag/src/index.ts`
- `packages/rag/src/indexer.spec.ts`
- `packages/rag/src/indexer.ts`
- `packages/rag/src/reranker.spec.ts`
- `packages/rag/src/reranker.ts`
- `packages/rag/src/retriever.spec.ts`
- `packages/rag/src/retriever.ts`
- `packages/rag/src/retry.ts`
- `packages/rag/src/security-regression.spec.ts`
- `packages/rag/src/telemetry.ts`
- `packages/rag/src/vector-security.ts`
- `packages/rag/src/vectorstore.ts`
- `packages/rag/tsconfig.json`
- `packages/rag/vitest.config.ts`
- `packages/react/src/citation-hooks.spec.tsx`
- `packages/react/src/citation-hooks.ts`
- `packages/ui/src/citations.spec.tsx`
- `packages/ui/src/citations.tsx`
- `packages/vectorstores/pgvector/README.md`
- `packages/vectorstores/pgvector/drizzle.config.ts`
- `packages/vectorstores/pgvector/migrations/0000_init.sql`
- `packages/vectorstores/pgvector/migrations/meta/0000_snapshot.json`
- `packages/vectorstores/pgvector/migrations/meta/_journal.json`
- `packages/vectorstores/pgvector/package.json`
- `packages/vectorstores/pgvector/project.json`
- `packages/vectorstores/pgvector/src/index.ts`
- `packages/vectorstores/pgvector/src/pg-vector-store.integration.spec.ts`
- `packages/vectorstores/pgvector/src/pg-vector-store.ts`
- `packages/vectorstores/pgvector/src/schema.ts`
- `packages/vectorstores/pgvector/tsconfig.json`
- `packages/vectorstores/pgvector/vitest.config.ts`

146 new files.

## Modified

- `docs/CHANGELOG_PHASES.md`, `docs/DECISIONS.md`, `docs/PROJECT_STATUS.md`,
  `docs/TECHNICAL_DEBT.md`, `docs/architecture/overview.md` — Phase 9 status/decision/debt
  entries and dependency-diagram update.
- `eslint.config.js` — dependency-boundary rules for `scope:knowledge`/`scope:rag`/
  `scope:vectorstore-pgvector`/`scope:memory`.
- `packages/protocol/src/errors.{ts,spec.ts}` — additive `CopilotErrorCode`s and factories
  (Section 129).
- `packages/react/src/index.ts` — export `useCitations`/`CitationData`/`UseCitationsResult`.
- `packages/server/src/index.ts` — export `createToolCallingExecutor`/`createFrontendToolBridge`
  (already-implemented internals, promoted to the public API — see
  [Implementation](Phase_9_Implementation.md)).
- `packages/ui/src/index.ts` — export `Citation`/`CitationList`/`SourcePreview`.
- `pnpm-lock.yaml` — new dependencies (see [Implementation](Phase_9_Implementation.md)'s
  dependency table).
- `pnpm-workspace.yaml` — fixed the broken `allowBuilds` scaffold that was hard-failing
  `pnpm install` (see [Issues](Phase_9_Issues.md)).
- `tools/vitest.shared.ts` — workspace aliases for the four new packages.
- `tsconfig.json` — project references for the four new packages.

## Fixed (real bugs, not new files)

- `packages/knowledge/src/loaders/web.ts` — unresolved-type lint failure in the streaming
  byte-limit check.
- `packages/vectorstores/pgvector/src/pg-vector-store.ts` — SQL operator-precedence bug in
  `search()`'s threshold condition.

See [Testing](Phase_9_Testing.md) for how each was found and confirmed fixed.
