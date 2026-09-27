# @gixcopilot/knowledge

Framework-independent knowledge source, document, and loader contracts for the AI Copilot SDK —
files, text, Markdown, PDF, DOCX, HTML/web, APIs, databases, object storage, and MCP resources,
each normalized into the same `KnowledgeDocument` shape. No chunking, embedding, or vector-store
concern lives here — see `@gixcopilot/rag`.

## Install

```bash
npm install @gixcopilot/knowledge
```

Requires Node.js >=22.12.0. ESM only.

```ts
import { pdfSource, defaultKnowledgeLoaders } from '@gixcopilot/knowledge';

const source = pdfSource({ id: 'handbook', path: './handbook.pdf', tenantId: 'tenant-a', acl: { permissions: ['knowledge.hr.read'] } });
for await (const doc of defaultKnowledgeLoaders.pdf!.load(source)) {
  console.log(doc.metadata.page, doc.content.slice(0, 80));
}
```

Attach `tenantId`/`acl` at the source (or per-document) level — that metadata is what
`@gixcopilot/rag`'s retriever later enforces against a trusted `SecurityContext`. The `web` loader
refuses loopback/link-local/private-range/non-HTTP(S) URLs and redirects; it is not a general
model-controlled fetch tool. `database`/`object-storage`/`mcp-resource` sources take a
host-supplied client or predefined safe query — never natural-language-to-SQL or an arbitrary
cloud SDK dependency.

See [Phase 9 API](../../docs/phases/phase-09/Phase_9_API.md),
[architecture](../../docs/phases/phase-09/Phase_9_Architecture.md), and
[limits](../../docs/phases/phase-09/Phase_9_Issues.md).

## Documentation

- [rag guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/rag.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/knowledge)

## License

MIT
