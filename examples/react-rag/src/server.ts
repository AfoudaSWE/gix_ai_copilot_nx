import { createModelRuntime } from '@gixcopilot/provider';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';
import { createInMemoryVectorStore, createOpenAIEmbeddingProvider } from '@gixcopilot/rag';
import { createVectorBackedMemoryStore } from '@gixcopilot/memory';
import { createPgVectorStore } from '@gixcopilot/vectorstore-pgvector';
import { createInMemoryAuditSink, createFieldRedactionDataPolicy } from '@gixcopilot/security';
import { indexExampleKnowledge } from './knowledge.js';
import { createRagService } from './service.js';
import { createRagServer } from './backend.js';

const apiKey = process.env['OPENAI_API_KEY'];
const model = process.env['OPENAI_MODEL'];
const database = process.env['DATABASE_URL'];
const knowledgeDb = database ? createPgVectorStore({ connectionString: database }) : undefined;
const memoryDb = database ? createPgVectorStore({ connectionString: database, table: 'memory' }) : undefined;
let service;
if (apiKey && model) {
  const embeddingProvider = createOpenAIEmbeddingProvider({ apiKey, model: process.env['OPENAI_EMBEDDING_MODEL'] ?? 'text-embedding-3-small' });
  const vectorStore = knowledgeDb ?? createInMemoryVectorStore();
  const dataPolicy = createFieldRedactionDataPolicy([]);
  await indexExampleKnowledge(vectorStore, embeddingProvider);
  service = createRagService({ vectorStore, embeddingProvider,
    memoryStore: createVectorBackedMemoryStore({ vectorStore: memoryDb ?? createInMemoryVectorStore(), embeddingProvider, dataPolicy }),
    runtime: createModelRuntime({ providers: [createOpenAIProvider({ apiKey })] }), model, dataPolicy, auditSink: createInMemoryAuditSink() });
}
const app = createRagServer(service);
app.addHook('onClose', async () => { await knowledgeDb?.close(); await memoryDb?.close(); });
await app.listen({ host: '127.0.0.1', port: 4324 });
console.log(`RAG example: http://127.0.0.1:4324 (${service ? 'real OpenAI; ' + (database ? 'pgvector' : 'in-memory development storage') : 'configuration required'})`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
