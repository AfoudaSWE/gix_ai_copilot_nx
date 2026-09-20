import { readFile } from 'node:fs/promises';
import { markdownLoader, markdownSource } from '@gixcopilot/knowledge';
import { createIndexer, createRecursiveChunker } from '@gixcopilot/rag';
import type { EmbeddingProvider, KnowledgeObserver, VectorStore } from '@gixcopilot/rag';

/** Actual development documents; no question matching or generated fixture answers. */
export async function indexExampleKnowledge(vectorStore: VectorStore, embeddingProvider: EmbeddingProvider, observer?: KnowledgeObserver): Promise<void> {
  const indexer = createIndexer({ vectorStore, embeddingProvider, chunker: createRecursiveChunker({ chunkSize: 900, chunkOverlap: 80 }), observer });
  for (const [id, name, permissions] of [
    ['handbook', 'Employee Handbook', []],
    ['supervisor', 'Supervisor Operations Guide', ['knowledge.supervisor.read']],
    ['admin', 'Admin Security Procedure', ['knowledge.admin.read']],
  ] as const) {
    const content = await readFile(new URL(`../knowledge/${id}.md`, import.meta.url), 'utf8');
    const result = await indexer.index({ source: markdownSource({ id, name, content, tenantId: 'demo', permissions }), loader: markdownLoader });
    if (result.errors.length) throw new Error(`Could not index example source ${id}.`);
  }
}
