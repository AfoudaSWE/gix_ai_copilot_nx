# @gixcopilot/memory

Framework-independent memory architecture for the AI Copilot SDK — working, session, durable, and
semantic memory, kept explicitly distinct from conversation history and from RAG. Ownership
(`user`/`session`/`tenant`/`workspace`/`application`) is derived only from a trusted
`SecurityContext`, never from model/query input, and asserted on every read/write.

This is a private workspace package. Install workspace dependencies with `pnpm install`; a
workspace host declares `"@gixcopilot/memory": "workspace:*"` in its dependencies. Build with
`pnpm --filter @gixcopilot/memory build`.

```ts
import { createVectorBackedMemoryStore, createMemoryService } from '@gixcopilot/memory';
import { createPgVectorStore } from '@gixcopilot/vectorstore-pgvector';

const store = createVectorBackedMemoryStore({
  vectorStore: createPgVectorStore({ connectionString, table: 'memory' }), // separate table from knowledge chunks
  embeddingProvider,
});
const memory = createMemoryService({ store, securityContext, persistence: 'explicit-confirmation', auditSink });
const record = await memory.save({ type: 'durable', value: 'Answer in English.' }, /* confirmed */ true);
```

A memory value that looks like a credential (API key, bearer token, `password:`/`api_key=` pair,
a PEM private key block) is rejected by the default write policy before it reaches storage.
`createMemoryService`'s `'explicit-confirmation'` default means "the model decided this looked
useful" is never enough on its own to persist something durably — every write also needs
`confirmed: true` from the caller (or an `'application-policy'`/`'never'` mode) and is audited.
Durable memory always registers at `'normal'` context priority via `formatMemoryContext`, one
tier below every `'critical'` system instruction, so it can never outrank the current explicit
instruction.

See [Phase 9 API](../../docs/phases/phase-09/Phase_9_API.md),
[architecture](../../docs/phases/phase-09/Phase_9_Architecture.md), and
[limits](../../docs/phases/phase-09/Phase_9_Issues.md).
