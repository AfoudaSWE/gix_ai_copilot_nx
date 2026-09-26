import { z } from 'zod';
import { textLoader, textSource } from '@gixcopilot/knowledge';
import type { KnowledgeACL } from '@gixcopilot/knowledge';
import { createDeterministicEmbeddingProvider, createIndexer, createInMemoryVectorStore, createRecursiveChunker, createRetriever } from '@gixcopilot/rag';
import type { EmbeddingProvider, RetrievalQuery, RetrievalResult, Retriever, VectorStore } from '@gixcopilot/rag';
import type { SecurityContext } from '@gixcopilot/security';
import { defineTool } from '@gixcopilot/tools';
import type { AnyToolDefinition } from '@gixcopilot/tools';
import { fail } from './assert.js';

export interface KnowledgeFixtureDocument {
  /** Becomes the source id citations and assertions refer to. */
  readonly id: string;
  readonly content: string;
  readonly title?: string;
  readonly tenantId?: string;
  /** Shorthand for an ACL requiring any of these permissions. */
  readonly permissions?: readonly string[];
  readonly acl?: KnowledgeACL;
}

export interface KnowledgeFixture {
  readonly vectorStore: VectorStore;
  readonly embeddingProvider: EmbeddingProvider;
  readonly retriever: Retriever;
  retrieve(query: string | RetrievalQuery, securityContext: SecurityContext): Promise<RetrievalResult>;
  /** A `knowledge.search` tool that takes the TRUSTED security context from the tool's
   * execution metadata - never from model arguments. */
  searchTool(options?: { readonly name?: string; readonly topK?: number }): AnyToolDefinition;
}

/**
 * Deterministic RAG fixture (Section 79, 189): real chunking, real (deterministic) embeddings,
 * the real in-memory vector store and the real ACL-filtering retriever. Only the embedding
 * model is deterministic - retrieval, ACL and citation behavior is production code.
 */
export async function createKnowledgeFixture(options: { readonly documents: readonly KnowledgeFixtureDocument[]; readonly tenantId?: string }): Promise<KnowledgeFixture> {
  const vectorStore = createInMemoryVectorStore();
  const embeddingProvider = createDeterministicEmbeddingProvider();
  const indexer = createIndexer({ vectorStore, embeddingProvider, chunker: createRecursiveChunker({ chunkSize: 600, chunkOverlap: 40 }) });
  for (const document of options.documents) {
    const result = await indexer.index({
      source: textSource({
        id: document.id,
        name: document.title ?? document.id,
        tenantId: document.tenantId ?? options.tenantId,
        content: document.content,
        permissions: document.permissions,
        acl: document.acl,
      }),
      loader: textLoader,
    });
    if (result.errors.length > 0) throw new Error(`Failed to index fixture document "${document.id}": ${result.errors.join('; ')}`);
  }
  const retriever = createRetriever({ vectorStore, embeddingProvider });

  return {
    vectorStore,
    embeddingProvider,
    retriever,
    retrieve: (query, securityContext) => retriever.retrieve(typeof query === 'string' ? { text: query, topK: 5 } : query, { securityContext }),
    searchTool(toolOptions = {}) {
      return defineTool({
        name: toolOptions.name ?? 'knowledge.search',
        description: 'Search the authorized knowledge base.',
        input: z.object({ query: z.string() }),
        // Classified like a real read tool; an unclassified tool fails closed to approval.
        security: { risk: 'read-only' },
        execute: async (input, context) => {
          const securityContext = (context.metadata as { securityContext?: SecurityContext } | undefined)?.securityContext;
          if (!securityContext) throw new Error('knowledge.search requires a trusted SecurityContext.');
          const result = await retriever.retrieve({ text: input.query, topK: toolOptions.topK ?? 3 }, { securityContext, signal: context.signal });
          return { results: result.items.map((item) => ({ text: item.item.chunk.content, citation: item.citationId, source: item.item.provenance.sourceId })) };
        },
      });
    },
  };
}

function sources(result: RetrievalResult): string[] {
  return [...new Set(result.citations.map((citation) => citation.sourceId))];
}

/** Retrieval assertions (Section 80). */
export function expectSourceRetrieved(result: RetrievalResult, sourceId: string): void {
  if (!sources(result).includes(sourceId)) fail(`Expected source "${sourceId}" to be retrieved; got [${sources(result).join(', ')}].`, result.diagnostics);
}

export function expectSourceNotRetrieved(result: RetrievalResult, sourceId: string): void {
  if (sources(result).includes(sourceId)) fail(`Expected source "${sourceId}" NOT to be retrieved, but it was.`, result.diagnostics);
}

export function expectCitation(result: RetrievalResult, sourceId: string): void {
  const citation = result.citations.find((candidate) => candidate.sourceId === sourceId);
  if (!citation) fail(`Expected a citation for source "${sourceId}".`, result.citations);
  if (!result.items.some((item) => item.citationId === citation.id)) fail(`Citation ${citation.id} does not map to a retrieved item.`, result.items);
}

/**
 * Asserts the ACL made the difference (Section 80): the same query returns `restrictedSource`
 * for an authorized caller and never for an unauthorized one. Comparing two identities is
 * required because the vector store enforces ACLs inside the search itself - a restricted
 * chunk never even becomes a visible "excluded" candidate.
 */
export async function expectAclApplied(
  fixture: KnowledgeFixture,
  query: string,
  options: { readonly restrictedSource: string; readonly authorized: SecurityContext; readonly unauthorized: SecurityContext },
): Promise<void> {
  const allowed = await fixture.retrieve(query, options.authorized);
  if (!sources(allowed).includes(options.restrictedSource)) {
    fail(`ACL check inconclusive: the authorized caller did not retrieve "${options.restrictedSource}" either.`, allowed.diagnostics);
  }
  const denied = await fixture.retrieve(query, options.unauthorized);
  if (sources(denied).includes(options.restrictedSource)) fail(`ACL not applied: an unauthorized caller retrieved "${options.restrictedSource}".`, denied.diagnostics);
}
