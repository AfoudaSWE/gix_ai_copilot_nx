import { textLoader, textSource } from '@gixcopilot/knowledge';
import { createIndexer, createInMemoryVectorStore, createRecursiveChunker, createDeterministicEmbeddingProvider } from '@gixcopilot/rag';
import type { EmbeddingProvider, VectorStore } from '@gixcopilot/rag';

/** A tiny, real knowledge base for the demo - genuine chunk/embed/index pipeline (Section
 * 170), not a fixture the agent's answer is matched against. Deliberately public (no ACL) -
 * this example's security story is the tool/knowledge-scope narrowing shown in
 * `examples/multi-agent`, not RAG permission tiers (already the dedicated subject of
 * `examples/react-rag`). */
export async function createExampleKnowledgeBase(): Promise<{
  readonly vectorStore: VectorStore;
  readonly embeddingProvider: EmbeddingProvider;
}> {
  const vectorStore = createInMemoryVectorStore();
  const embeddingProvider = createDeterministicEmbeddingProvider();
  const indexer = createIndexer({
    vectorStore,
    embeddingProvider,
    chunker: createRecursiveChunker({ chunkSize: 400, chunkOverlap: 40 }),
  });

  const result = await indexer.index({
    source: textSource({
      id: 'application-policy',
      name: 'Application Review Policy',
      tenantId: 'demo',
      content:
        'Applications move through three statuses: submitted, under_review, and approved. ' +
        'An application is only approved once a reviewer has confirmed the applicant\'s ' +
        'identity documents and verified their payment method. Once approved, the applicant ' +
        'receives a confirmation email within one business day.',
    }),
    loader: textLoader,
  });
  if (result.errors.length > 0) {
    throw new Error(`Failed to index example knowledge: ${result.errors.join('; ')}`);
  }

  return { vectorStore, embeddingProvider };
}
