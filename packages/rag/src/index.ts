export type { ChunkMetadata, KnowledgeChunk } from './chunk.js';
export { deriveChunkId, hashChunkContent } from './chunk.js';

export type { Chunker, RecursiveChunkerOptions } from './chunker.js';
export { createRecursiveChunker } from './chunker.js';

export type { EmbeddingProvider } from './embeddings/embedding-provider.js';
export type { DeterministicEmbeddingProviderOptions } from './embeddings/deterministic.js';
export { createDeterministicEmbeddingProvider } from './embeddings/deterministic.js';
export type { CreateOpenAIEmbeddingProviderOptions } from './embeddings/openai.js';
export { createOpenAIEmbeddingProvider } from './embeddings/openai.js';

export type {
  VectorRecord,
  VectorMetadataFilter,
  VectorSearch,
  VectorSearchResult,
  VectorDeleteFilter,
  VectorStore,
  VectorAccess,
  VectorList,
} from './vectorstore.js';
export { isValidKnowledgeAcl, matchesKnowledgeAcl, validateVector, validateLimit } from './vector-security.js';
export { createInMemoryVectorStore } from './in-memory-vectorstore.js';

export type { IndexResult, IndexOptions, Indexer, CreateIndexerOptions } from './indexer.js';
export { createIndexer } from './indexer.js';

export type {
  RetrievalQuery,
  RetrievalDataPolicy,
  RetrievalContext,
  RetrievalExclusionReason,
  RetrievalExclusion,
  RetrievalProvenance,
  RetrievalItem,
  RetrievalDiagnostics,
  RetrievalResult,
  Retriever,
  CreateRetrieverOptions,
} from './retriever.js';
export { createRetriever } from './retriever.js';

export type { Reranker } from './reranker.js';
export { createSimilarityReranker } from './reranker.js';

export type { Citation, WithCitation, CitationValidationResult } from './citations.js';
export { assignCitationIds, validateCitations } from './citations.js';

export type { ContextContribution } from './context.js';
export { formatKnowledgeContext, hasAuthorizedResults, retrievalHit, citationPresence, citationValidity, citationsForContext } from './context.js';

export type { RetryOptions } from './retry.js';
export { withRetry } from './retry.js';
export { measureKnowledge } from './telemetry.js';
export type { KnowledgeObserver, KnowledgeMeasurement } from './telemetry.js';
