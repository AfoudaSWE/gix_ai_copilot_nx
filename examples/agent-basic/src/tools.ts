import { z } from 'zod';
import { defineTool } from '@gixcopilot/tools';
import { createRetriever } from '@gixcopilot/rag';
import type { EmbeddingProvider, VectorStore } from '@gixcopilot/rag';
import { createInMemoryMemoryStore, createMemoryService } from '@gixcopilot/memory';
import type { MemoryStore } from '@gixcopilot/memory';
import type { SecurityContext } from '@gixcopilot/security';

/** A tiny, deterministic "database" - real state a real tool call reads/writes, not a
 * fixture matched against the question text (Section 169). */
const applications = new Map<string, { status: string; applicant: string }>([
  ['APP-1024', { status: 'under_review', applicant: 'Jordan Miles' }],
]);

export const getApplicationTool = defineTool({
  name: 'applications.get',
  description: 'Look up an application by its id.',
  input: z.object({ id: z.string() }),
  execute: (input) => {
    const application = applications.get(input.id);
    if (!application) return Promise.resolve({ found: false });
    return Promise.resolve({ found: true, ...application });
  },
});

/**
 * Knowledge/RAG integration (Section 36, 170) done through the tool boundary, since the
 * current `@gixcopilot/agents` runtime does not itself call `@gixcopilot/context`'s Context
 * Engine (see `AgentKnowledgeConfig`'s own doc comment) - a composition layer scopes
 * retrieval this way instead. Reads its already-narrowed source list from
 * `context.metadata.knowledgeSources` (Section 60) rather than trusting the model to say
 * which sources it may search - the same defense-in-depth the tool-name intersection already
 * demonstrates.
 */
export function createKnowledgeSearchTool(vectorStore: VectorStore, embeddingProvider: EmbeddingProvider) {
  const retriever = createRetriever({ vectorStore, embeddingProvider });
  return defineTool({
    name: 'knowledge.search',
    description: 'Search the authorized knowledge base for policy/reference information.',
    input: z.object({ query: z.string() }),
    execute: async (input, context) => {
      const metadata = context.metadata as { securityContext?: SecurityContext } | undefined;
      if (!metadata?.securityContext) {
        throw new Error('knowledge.search requires a trusted SecurityContext.');
      }
      const retrieval = await retriever.retrieve(
        { text: input.query, topK: 3 },
        { securityContext: metadata.securityContext, signal: context.signal },
      );
      return {
        results: retrieval.items.map((item) => ({ text: item.item.chunk.content, citation: item.citationId })),
      };
    },
  });
}

/** Working memory (Section 37-38, 170) through the tool boundary - the trusted `SecurityContext`
 * (never model input) determines ownership, per `ownerFromSecurityContext`. */
export function createMemoryTools(store: MemoryStore) {
  const recall = defineTool({
    name: 'memory.recall',
    description: "Search the current user's own saved memory.",
    input: z.object({ query: z.string().optional() }),
    execute: async (input, context) => {
      const metadata = context.metadata as { securityContext?: SecurityContext } | undefined;
      if (!metadata?.securityContext) throw new Error('memory.recall requires a trusted SecurityContext.');
      const service = createMemoryService({ store, securityContext: metadata.securityContext });
      const results = await service.search(input.query ? { text: input.query, topK: 5 } : { topK: 5 });
      return { results: results.map((result) => ({ id: result.record.id, value: result.record.value })) };
    },
  });
  const save = defineTool({
    name: 'memory.save',
    description: 'Remember a durable fact about the current user for future turns.',
    input: z.object({ value: z.string() }),
    execute: async (input, context) => {
      const metadata = context.metadata as { securityContext?: SecurityContext } | undefined;
      if (!metadata?.securityContext) throw new Error('memory.save requires a trusted SecurityContext.');
      const service = createMemoryService({
        store,
        securityContext: metadata.securityContext,
        persistence: 'application-policy',
      });
      const record = await service.save(
        { type: 'durable', value: input.value, provenance: 'application-generated' },
        true,
      );
      return { saved: true, id: record.id };
    },
  });
  return { recall, save };
}

export function createExampleMemoryStore(): MemoryStore {
  return createInMemoryMemoryStore();
}
