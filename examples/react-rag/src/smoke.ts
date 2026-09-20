import { writeFile } from 'node:fs/promises';
import { createModelRuntime } from '@gixcopilot/provider';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';
import { createOpenAIEmbeddingProvider } from '@gixcopilot/rag';
import type { KnowledgeMeasurement } from '@gixcopilot/rag';
import { createPgVectorStore } from '@gixcopilot/vectorstore-pgvector';
import { createVectorBackedMemoryStore } from '@gixcopilot/memory';
import { createRagService } from './service.js';
import { indexExampleKnowledge } from './knowledge.js';
import { demoSecurityContext } from './backend.js';

/** Explicitly invoked, paid-provider smoke; normal unit tests never execute this file. */
const apiKey = process.env['OPENAI_API_KEY'];
const model = process.env['OPENAI_MODEL'];
const connectionString = process.env['RAG_SMOKE_DATABASE_URL'];
if (!apiKey || !model || !connectionString) throw new Error('Set OPENAI_API_KEY, OPENAI_MODEL and RAG_SMOKE_DATABASE_URL (a disposable migrated database).');
const embeddingProvider = createOpenAIEmbeddingProvider({ apiKey, model: process.env['OPENAI_EMBEDDING_MODEL'] ?? 'text-embedding-3-small' });
const vectorStore = createPgVectorStore({ connectionString });
const memoryVectors = createPgVectorStore({ connectionString, table: 'memory' });
const measurements: KnowledgeMeasurement[] = [];
const observer = (measurement: KnowledgeMeasurement): void => { measurements.push(measurement); };
const viewer = demoSecurityContext('viewer');
const admin = demoSecurityContext('admin');
if (!viewer || !admin) throw new Error('Missing demo identity.');
try {
  const started = performance.now();
  await indexExampleKnowledge(vectorStore, embeddingProvider, observer);
  const indexingMs = performance.now() - started;
  const service = createRagService({ vectorStore, embeddingProvider, model, observer,
    memoryStore: createVectorBackedMemoryStore({ vectorStore: memoryVectors, embeddingProvider }),
    runtime: createModelRuntime({ providers: [createOpenAIProvider({ apiKey })] }) });
  const publicAnswer = await service.ask('How many days of annual leave do employees get? Cite a source.', viewer);
  if (!publicAnswer.grounded || !publicAnswer.text.includes('25')) throw new Error('Cited public answer failed.');
  const forbidden = await service.ask('What is the master encryption key rotation schedule?', viewer);
  if (/37|ORCHID/i.test(forbidden.text) || forbidden.citations.some((citation) => citation.sourceId === 'admin')) throw new Error('Restricted answer leaked.');
  const allowed = await service.ask('What is the master encryption key rotation schedule? Cite a source.', admin);
  if (!allowed.text.includes('37') || !allowed.grounded) throw new Error('Authorized admin answer failed.');
  const memory = await service.memory(viewer).save({ id: 'phase9-smoke-language', type: 'durable', value: 'Always answer in English.', provenance: 'explicit-user-save' }, true);
  const arabic = await service.ask('أجب باللغة العربية فقط: كم يوماً من الإجازة السنوية يحصل الموظفون؟', viewer);
  if (!/[\u0600-\u06ff]/.test(arabic.text)) throw new Error('Current language instruction did not win.');
  await service.memory(viewer).forget(memory.id);
  if (await service.memory(viewer).get(memory.id)) throw new Error('Forgotten memory still exists.');
  const report = { status: 'PASS', date: new Date().toISOString(), provider: 'openai', model, embeddingModel: embeddingProvider.model,
    indexingMs, flows: ['real embeddings -> pgvector -> permission filter -> ContextEngine -> OpenAI -> citations',
      'viewer denied restricted answer', 'admin authorized restricted answer', 'current Arabic instruction overrides English memory', 'memory deletion'], measurements };
  await writeFile(new URL('../../../docs/phases/phase-09/real-smoke.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await vectorStore.close(); await memoryVectors.close();
}
