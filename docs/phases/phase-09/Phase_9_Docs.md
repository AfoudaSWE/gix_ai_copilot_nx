# Phase 9 — Knowledge + RAG + Memory

Phase 9 adds an enterprise knowledge layer (sources, loaders, parsers, chunking, embeddings, a
storage-agnostic vector store, permission-aware retrieval, reranking and citations) and an
explicit memory architecture (working, session, durable and semantic memory, kept distinct from
conversation history and from RAG) to the SDK. Both flow into the *existing* Phase 4 Context
Engine and are governed by the *existing* Phase 7 `SecurityContext`/Action Firewall/data-policy
stack — there is no second prompt-construction engine and no second authorization path. It does
not implement agents, multi-agent orchestration, a DevTools platform, Angular, or an enterprise
management platform — see [Issues](Phase_9_Issues.md) and the phase-gate skill for the explicit
boundary.

| File | Contents |
| --- | --- |
| [Architecture](Phase_9_Architecture.md) | Package boundaries, the ingestion/retrieval/memory pipelines, security model |
| [Implementation](Phase_9_Implementation.md) | Code responsibilities, dependencies, tradeoffs |
| [Status](Phase_9_Status.md) | Acceptance checklist and completion report |
| [Testing](Phase_9_Testing.md) | Executed checks and measured evidence, including a real OpenAI + real Postgres run |
| [Decisions](Phase_9_Decisions.md) | ADR index and design decisions |
| [API](Phase_9_API.md) | All exported functions and public types |
| [Files](Phase_9_Files.md) | Created and modified files |
| [Issues](Phase_9_Issues.md) | Bugs found and fixed, known limits, out-of-scope items |
| [Handoff](Phase_9_Handoff.md) | Running the example and future maintenance |

Prior records: [Phase 1](../phase-01/Phase_1_Docs.md), [Phase 2](../phase-02/Phase_2_Docs.md),
[Phase 3](../phase-03/Phase_3_Docs.md), [Phase 4](../phase-04/Phase_4_Docs.md),
[Phase 5](../phase-05/Phase_5_Docs.md), [Phase 6](../phase-06/Phase_6_Docs.md),
[Phase 7](../phase-07/Phase_7_Docs.md), [Phase 8](../phase-08/Phase_8_Docs.md). The canonical
dependency-direction diagram remains `docs/architecture/overview.md`, extended here with the new
`@gixcopilot/knowledge`, `@gixcopilot/rag`, `@gixcopilot/vectorstore-pgvector` and
`@gixcopilot/memory` packages.

Quick start from the workspace root:

```sh
pnpm install
pnpm build
pnpm --filter @gixcopilot/react-rag test
```

The example also has an interactive `pnpm dev`/`pnpm server` (real OpenAI + optional real
Postgres) and an explicit real-provider smoke check (`pnpm --filter @gixcopilot/react-rag run
smoke`, requiring `OPENAI_API_KEY`/`OPENAI_MODEL`/`RAG_SMOKE_DATABASE_URL`) whose most recent
result is committed at [real-smoke.json](real-smoke.json) — see
[Phase 9 Handoff](Phase_9_Handoff.md) for exact commands.
