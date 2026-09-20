# Phase 9 public API

## Knowledge (`@gixcopilot/knowledge`)

```ts
import { createKnowledgeSourceRegistry, pdfSource, defaultKnowledgeLoaders } from '@gixcopilot/knowledge';

const sources = createKnowledgeSourceRegistry();
sources.register(pdfSource({ id: 'handbook', path: './handbook.pdf', tenantId: 'tenant-a', acl: { permissions: ['knowledge.hr.read'] } }));
for await (const doc of defaultKnowledgeLoaders.pdf!.load(sources.get('handbook')!)) { /* KnowledgeDocument */ }
```

| Export | Contract |
| --- | --- |
| `createKnowledgeSourceRegistry` | `register`/`get`/`list`/`remove`; not a mandatory global singleton |
| `textSource`, `markdownSource`, `pdfSource`, `docxSource`, `htmlSource`, `webSource`, `apiSource`, `createDatabaseKnowledgeSource`, `objectStorageSource`, `mcpResourceSource`, `fileSource`, `customSource` | Typed `KnowledgeSource<TConfig>` constructors per Section 10's source types |
| `textLoader`, `markdownLoader`, `pdfLoader`, `docxLoader`, `htmlLoader`, `fileLoader`, `webLoader`, `apiLoader`, `databaseLoader`/`createDatabaseLoader`, `objectStorageLoader`, `mcpResourceLoader` | Each a `DocumentLoader<TConfig>`: `load(source, context?) => AsyncIterable<KnowledgeDocument>` |
| `defaultKnowledgeLoaders` | `Partial<Record<KnowledgeSourceType, DocumentLoader>>` lookup table; `custom` has no default |
| `createKnowledgeDocument`, `deriveDocumentId`, `hashContent` | Normalized `KnowledgeDocument` construction with stable, content-hash-based identity |
| `normalizeText` | Line-ending/whitespace/invalid-character normalization without destroying structure |
| `extractHtmlStructure`, `serializeTable` | HTML → `{ title?, text }`, deterministic table-to-text |
| `assertSafeWebUrl`, `SsrfGuardError` | Blocks loopback/link-local/private ranges and non-HTTP(S) schemes before any remote fetch |
| `isUnrestrictedAcl` | `KnowledgeACL` with no populated field grants no additional restriction beyond tenant scope |

## RAG (`@gixcopilot/rag`)

```ts
import { createRecursiveChunker, createOpenAIEmbeddingProvider, createIndexer, createRetriever, formatKnowledgeContext } from '@gixcopilot/rag';
import { createPgVectorStore } from '@gixcopilot/vectorstore-pgvector';

const vectorStore = createPgVectorStore({ connectionString: process.env.DATABASE_URL });
const embeddingProvider = createOpenAIEmbeddingProvider({ apiKey: process.env.OPENAI_API_KEY!, model: 'text-embedding-3-small' });
await createIndexer({ vectorStore, embeddingProvider, chunker: createRecursiveChunker() }).index({ source, loader });
const result = await createRetriever({ vectorStore, embeddingProvider }).retrieve({ text: 'annual leave policy' }, { securityContext });
const contributions = formatKnowledgeContext(result); // register each into the real ContextEngine
```

| Export | Contract |
| --- | --- |
| `deriveChunkId`, `hashChunkContent` | Deterministic chunk identity (document + position + content) |
| `createRecursiveChunker` | `Chunker`: size/overlap/separator-hierarchy chunking, structure-aware |
| `EmbeddingProvider`, `createDeterministicEmbeddingProvider`, `createOpenAIEmbeddingProvider` | Provider-neutral embedding contract; hash-based test adapter and real OpenAI adapter |
| `VectorStore`, `createInMemoryVectorStore` | Storage-agnostic contract; deterministic in-memory implementation for tests/small examples |
| `isValidKnowledgeAcl`, `matchesKnowledgeAcl`, `validateVector`, `validateLimit` | Shared ACL-shape validation and embedding/limit guards used by every `VectorStore` implementation |
| `createIndexer` | `index(source, loader?)` → documents/chunks loaded/indexed/skipped/errors + duration; atomic reindex via `VectorStore.replace` when available |
| `createRetriever` | `retrieve(query, { securityContext, policies?, dataPolicy? })` → authorized, ranked, cited `RetrievalResult` with full `RetrievalDiagnostics` |
| `createSimilarityReranker` | Section 68 baseline `Reranker`; the interface allows a cross-encoder/LLM/provider reranker to replace it without touching retrieval |
| `assignCitationIds`, `validateCitations` | Stable `[S1]`/`[S2]` ID assignment and post-hoc validation against the actually-retrieved set |
| `formatKnowledgeContext`, `hasAuthorizedResults`, `citationsForContext` | Context-engine-ready contributions; `citationsForContext` narrows citations to only what survived the real token budget |
| `retrievalHit`, `citationPresence`, `citationValidity` | Small evaluation primitives (Phase 11 owns the full platform) |
| `withRetry` | Bounded retry for transient embedding/vector-store failures |
| `measureKnowledge` | Content-free stage timing (`chunk`/`embed.*`/`index.*`/`vector.search`/`rerank`/…); never logs source/query/value payloads |

## PostgreSQL + pgvector (`@gixcopilot/vectorstore-pgvector`)

```ts
import { createPgVectorStore } from '@gixcopilot/vectorstore-pgvector';

const knowledgeStore = createPgVectorStore({ connectionString }); // table: 'knowledge_chunks' (default)
const memoryStore = createPgVectorStore({ connectionString, table: 'memory' }); // table: 'memory_embeddings'
```

`createPgVectorStore({ connectionString? | pool?, table? })` implements `VectorStore` plus
`replace(filter, records)` (atomic, advisory-locked reindex), `list(query)` (exact-match listing
without an embedding round trip), and `close()`. Run
`CREATE EXTENSION IF NOT EXISTS vector;` and `migrations/0000_init.sql` once per database
(Section 177 — some managed Postgres providers require an admin action for the extension).

## Memory (`@gixcopilot/memory`)

```ts
import { createInMemoryMemoryStore, createVectorBackedMemoryStore, createMemoryService, ownerFromSecurityContext } from '@gixcopilot/memory';

const store = createVectorBackedMemoryStore({ vectorStore: memoryStore, embeddingProvider });
const memory = createMemoryService({ store, securityContext, persistence: 'explicit-confirmation', auditSink });
const record = await memory.save({ type: 'durable', value: 'Answer in English.' }, /* confirmed */ true);
await memory.forget(record.id);
```

| Export | Contract |
| --- | --- |
| `MemoryRecord<T>`, `MemoryOwner`, `MemoryType`, `MemoryProvenance` | The five-concept taxonomy (Section 87-88); `isMemoryExpired`, `memoryOwnersEqual`, `memoryOwnerKey` are the pure helpers every store shares |
| `MemoryStore` | `put`/`get`/`search`/`delete`, satisfied identically by both stores below |
| `createInMemoryMemoryStore` | Deterministic store for tests and working/session memory; optional `embeddingProvider` enables `search({ text })` |
| `createVectorBackedMemoryStore` | Durable/semantic memory persisted through any rag `VectorStore` (typically `createPgVectorStore({ table: 'memory' })`); `search()` requires `text` |
| `assertMemoryAccess`, `ownerFromSecurityContext` | Owner/tenant enforcement and trusted-context-only owner derivation (Section 95/114/145) |
| `createDefaultMemoryWritePolicy`, `createPermissiveMemoryWritePolicy`, `containsSensitiveContent` | Credential-shaped-value write rejection (Section 100-102); the permissive variant is for tests/examples that intentionally opt out |
| `createMemoryService` | Binds a trusted `SecurityContext` once; `save` requires `confirmed: true` (or an `'application-policy'`/`'never'` mode) and every call is audited |
| `formatMemoryContext`, `hasMemoryResults` | Context-engine-ready contributions fixed at `'normal'` priority (Section 108/109) |

## React / UI headless citation APIs

```tsx
import { useCitations } from '@gixcopilot/react';
import { CitationList } from '@gixcopilot/ui';

function Answer({ citations }: { citations: readonly CitationData[] }) {
  const { citations: list } = useCitations(citations);
  return <CitationList citations={list} />;
}
```

`useCitations(citations: readonly CitationData[])` is headless state only (Section 125) — which
citation, if any, is currently expanded — over a plain `CitationData` (`id`, `sourceId?`,
`documentId?`, `title?`, `uri?`, `page?`, `section?`, `excerpt?`) the host application supplies;
`@gixcopilot/react` never depends on `@gixcopilot/rag`. `<Citation />`/`<CitationList />`/
`<SourcePreview />` (from `@gixcopilot/ui`) render that same data, never a source URL or ACL
metadata directly (Section 76). No speculative `useKnowledgeSources()`/`useMemory()` hook was
added to the public SDK surface — see [Issues](Phase_9_Issues.md) for why.

## Server building blocks (`@gixcopilot/server`)

`createToolCallingExecutor(options)` and `createFrontendToolBridge()` — already used internally
by `createServer` — are now public, for hosts that need to run the Model → Tool → Model loop
directly (e.g. a test harness proving the Action Firewall holds without a full HTTP/SSE round
trip). Calling a generated tool's `.execute()` directly, or constructing the executor without an
`ActionFirewall`, is a trusted host operation and bypasses governed dispatch — models must reach
tools only through the canonical server/runtime path.

Full type definitions are in each package's `src/index.ts` exports and generated `.d.ts` files.
