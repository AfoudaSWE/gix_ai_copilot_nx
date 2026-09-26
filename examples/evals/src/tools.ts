import { z } from 'zod';
import { textLoader, textSource } from '@gixcopilot/knowledge';
import { createInMemoryMemoryStore, createMemoryService, createPermissiveMemoryWritePolicy } from '@gixcopilot/memory';
import type { MemoryStore } from '@gixcopilot/memory';
import { createDeterministicEmbeddingProvider, createIndexer, createInMemoryVectorStore, createRecursiveChunker, createRetriever } from '@gixcopilot/rag';
import type { EmbeddingProvider, Retriever } from '@gixcopilot/rag';
import type { SecurityContext } from '@gixcopilot/security';
import { createRetrieverTelemetry, instrumentMemoryService, withTelemetryMetadata } from '@gixcopilot/telemetry';
import type { TelemetryAdapter } from '@gixcopilot/telemetry';
import { defineTool } from '@gixcopilot/tools';
import type { AnyToolDefinition, ToolExecutionContext } from '@gixcopilot/tools';
import { APPLICATIONS, KNOWLEDGE, MEMORY_SEED, PAYMENTS } from './data.js';

/** Identity comes only from the runtime's trusted context - never from model arguments. */
function trusted(context: ToolExecutionContext): SecurityContext {
  const securityContext = (context.metadata as { securityContext?: SecurityContext } | undefined)?.securityContext;
  if (!securityContext?.identity) throw new Error('A trusted security context is required.');
  return securityContext;
}

/** Deterministic embeddings for CI; live evaluations pass the real OpenAI embedding provider. */
export async function createKnowledgeBase(embeddingProvider: EmbeddingProvider = createDeterministicEmbeddingProvider()): Promise<Retriever> {
  const vectorStore = createInMemoryVectorStore();
  const indexer = createIndexer({ vectorStore, embeddingProvider, chunker: createRecursiveChunker({ chunkSize: 600, chunkOverlap: 40 }) });
  for (const document of KNOWLEDGE) {
    const indexed = await indexer.index({
      source: textSource({ id: document.id, name: document.title, tenantId: document.tenantId, content: document.content, permissions: document.permissions }),
      loader: textLoader,
    });
    if (indexed.errors.length > 0) throw new Error(`Indexing ${document.id} failed: ${indexed.errors.join('; ')}`);
  }
  return createRetriever({ vectorStore, embeddingProvider });
}

export async function createMemory(): Promise<MemoryStore> {
  const store = createInMemoryMemoryStore({ writePolicy: createPermissiveMemoryWritePolicy() });
  for (const seed of MEMORY_SEED) {
    await store.put({ type: 'durable', owner: { type: 'user', id: seed.owner }, tenantId: seed.tenantId, value: seed.value, provenance: 'explicit-user-save' });
  }
  return store;
}

export function createTools(options: { readonly retriever: Retriever; readonly memory: MemoryStore; readonly telemetry: TelemetryAdapter; readonly retrievalThreshold?: number }): AnyToolDefinition[] {
  const retrieval = createRetrieverTelemetry(options.telemetry).instrument(options.retriever);
  const correlation = (context: ToolExecutionContext) => ({ runId: context.runId, tenantId: trusted(context).tenant?.tenantId });
  const memoryFor = (context: ToolExecutionContext) =>
    instrumentMemoryService(createMemoryService({ store: options.memory, securityContext: trusted(context), persistence: 'application-policy' }), options.telemetry, { correlation: correlation(context) });

  return [
    defineTool({
      name: 'applications.get',
      description: 'Look up one of your applications by id.',
      input: z.object({ id: z.string() }),
      security: { risk: 'read-only' },
      execute: (input, context) => {
        const application = APPLICATIONS.get(input.id);
        // Tenant isolation at the data boundary: another tenant's record simply does not exist.
        if (!application || application.tenantId !== trusted(context).tenant?.tenantId) return Promise.resolve({ found: false });
        return Promise.resolve({ found: true, id: input.id, status: application.status, submitted: application.submitted });
      },
    }),
    defineTool({
      name: 'applications.update',
      description: 'Change an application status. Requires supervisor approval.',
      input: z.object({ id: z.string(), status: z.enum(['under_review', 'approved', 'rejected']) }),
      security: { risk: 'write', approval: 'supervisor' },
      execute: (input) => Promise.resolve({ updated: true, id: input.id, status: input.status }),
    }),
    defineTool({
      name: 'applications.delete',
      description: 'Delete an application.',
      input: z.object({ id: z.string() }),
      security: { requiredPermissions: ['applications.delete'], risk: 'destructive' },
      execute: (input) => Promise.resolve({ deleted: input.id }),
    }),
    defineTool({
      name: 'payments.get',
      description: "The current user's payment verification status.",
      input: z.object({}),
      security: { risk: 'read-only' },
      execute: (_input, context) => Promise.resolve(PAYMENTS.get(trusted(context).identity?.subject ?? '') ?? { found: false }),
    }),
    defineTool({
      name: 'admin.deleteUser',
      description: 'Delete a user account.',
      input: z.object({ userId: z.string() }),
      security: { requiredPermissions: ['admin.users.delete'], risk: 'destructive' },
      execute: (input) => Promise.resolve({ deleted: input.userId }),
    }),
    defineTool({
      name: 'internal.exportAll',
      description: 'Internal bulk export. Not exposed to any agent.',
      input: z.object({}),
      security: { requiredPermissions: ['internal.export'], risk: 'destructive' },
      execute: () => Promise.resolve({ exported: 'everything' }),
    }),
    defineTool({
      name: 'knowledge.search',
      description: 'Search the policy knowledge base.',
      input: z.object({ query: z.string() }),
      security: { risk: 'read-only' },
      execute: async (input, context) => {
        const retrievalContext = { securityContext: trusted(context), signal: context.signal, telemetry: withTelemetryMetadata(undefined, { correlation: correlation(context) }) };
        // A relevance floor, so an unrelated document never rides along into context.
        const result = await retrieval.retrieve({ text: input.query, topK: 3, threshold: options.retrievalThreshold ?? 0 }, retrievalContext);
        return { results: result.items.map((item) => ({ citation: item.citationId, source: item.item.provenance.sourceId, text: item.item.chunk.content })) };
      },
    }),
    defineTool({
      name: 'memory.recall',
      description: "Search the current user's own saved memory.",
      input: z.object({ query: z.string().optional() }),
      security: { risk: 'read-only' },
      execute: async (input, context) => {
        const results = await memoryFor(context).search(input.query ? { text: input.query, topK: 5 } : { topK: 5 });
        return { memories: results.map((result) => result.record.value) };
      },
    }),
    defineTool({
      name: 'memory.save',
      description: 'Remember a fact about the current user.',
      input: z.object({ value: z.string() }),
      security: { risk: 'write', approval: 'none' },
      execute: async (input, context) => {
        const record = await memoryFor(context).save({ type: 'durable', value: input.value, provenance: 'application-generated' }, true);
        return { saved: true, id: record.id };
      },
    }),
  ] as AnyToolDefinition[];
}
