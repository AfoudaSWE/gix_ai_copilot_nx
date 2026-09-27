import { cpus, totalmem, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createContextEngine, createContextRegistry } from '@gixcopilot/context';
import { createInMemoryControlPlaneStore, createManagementService } from '@gixcopilot/management';
import { createCopilot } from '@gixcopilot/node';
import { parseEvent, serializeEvent, PROTOCOL_VERSION } from '@gixcopilot/protocol';
import type { CopilotEvent } from '@gixcopilot/protocol';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { createDeterministicEmbeddingProvider, createInMemoryVectorStore, createRetriever } from '@gixcopilot/rag';
import { createActionFirewall, createInMemoryAuditSink } from '@gixcopilot/security';
import { createDefaultToolResolver, createToolRegistry, createToolRuntime, defineTool } from '@gixcopilot/tools';
import { z } from 'zod';

/**
 * Phase 12 Section 146, 149: measurements of meaningful SDK operations on THIS machine. The
 * numbers describe this environment only; they are not universal benchmarks.
 *   node apps/api/dist/benchmarks.js [--streams 200] [--json]
 */
const args = process.argv.slice(2);
const streams = Number(args[args.indexOf('--streams') + 1] ?? 200) || 200;
const results: Record<string, unknown> = {
  environment: { node: process.version, platform: `${platform()} ${release()}`, cpu: cpus()[0]?.model, cores: cpus().length, memoryGb: Math.round(totalmem() / 1e9) },
};
const pct = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round((sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0) * 100) / 100;
};
async function time(label: string, iterations: number, fn: (index: number) => unknown): Promise<void> {
  for (let index = 0; index < Math.min(50, iterations); index += 1) await fn(index); // warm up
  const samples: number[] = [];
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const t = performance.now();
    await fn(index);
    samples.push(performance.now() - t);
  }
  const total = performance.now() - started;
  results[label] = { iterations, meanMs: Math.round((total / iterations) * 1000) / 1000, p50Ms: pct(samples, 50), p95Ms: pct(samples, 95), opsPerSec: Math.round(iterations / (total / 1000)) };
}

// 1. Concurrent streaming over real HTTP (SSE), mock provider with realistic token pacing.
{
  const chunks = Array.from({ length: 40 }, (_, index) => `token${index} `);
  const copilot = createCopilot({ model: { provider: 'mock', model: 'm' }, providers: [createMockProvider({ id: 'mock', scenario: { chunks, delayMsPerChunk: 10 } })] });
  const url = await copilot.listen({ port: 0 });
  const heapBefore = process.memoryUsage().rss;
  const firstByte: number[] = [];
  const complete: number[] = [];
  let failed = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: streams }, async () => {
      const t = performance.now();
      try {
        const response = await fetch(`${url}/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }) });
        // The server tsconfig has no DOM lib; give the web stream reader its narrow shape.
        const reader = response.body?.getReader() as { read(): Promise<{ done: boolean; value?: Uint8Array }> } | undefined;
        let seenFirst = false;
        let text = '';
        for (;;) {
          const chunk = reader ? await reader.read() : { done: true, value: undefined };
          const { done, value } = chunk;
          if (done) break;
          if (!seenFirst) {
            firstByte.push(performance.now() - t);
            seenFirst = true;
          }
          if (value) text += new TextDecoder().decode(value);
        }
        if (!text.includes('run.completed')) failed += 1;
        complete.push(performance.now() - t);
      } catch {
        failed += 1;
      }
    }),
  );
  results['concurrentStreams'] = {
    streams,
    tokensPerStream: chunks.length,
    tokenPacingMs: 10,
    wallMs: Math.round(performance.now() - started),
    firstByteP50Ms: pct(firstByte, 50),
    firstByteP95Ms: pct(firstByte, 95),
    completeP50Ms: pct(complete, 50),
    completeP95Ms: pct(complete, 95),
    failed,
    rssDeltaMb: Math.round((process.memoryUsage().rss - heapBefore) / 1e6),
  };
  await copilot.close();
}

// 2. Protocol serialization + validated parsing of a streamed delta event.
const event: CopilotEvent = { id: 'e1', runId: 'r1', threadId: 't1', timestamp: new Date().toISOString(), protocolVersion: PROTOCOL_VERSION, sequence: 1, type: 'message.delta', messageId: 'm1', delta: 'Hello world' };
await time('protocolSerializeParse', 20_000, () => parseEvent(JSON.parse(serializeEvent(event))));

// 3. Context resolution: 50 registered items within an 8k-token budget.
{
  const registry = createContextRegistry();
  for (let index = 0; index < 50; index += 1) registry.register({ id: `item-${index}`, name: `Item ${index}`, scope: 'page', value: { index, text: 'x'.repeat(400) } });
  const engine = createContextEngine({ maxContextTokens: 8000 });
  await time('contextResolve50Items', 2_000, () => engine.resolve(registry));
}

// 4. Tool runtime: lookup, schema validation and execution of a trivial tool.
{
  const registry = createToolRegistry();
  for (let index = 0; index < 200; index += 1) registry.register(defineTool({ name: `ns${index}.get`, description: 'x', input: z.object({ id: z.string() }), execute: ({ id }) => Promise.resolve({ id }) }));
  const runtime = createToolRuntime({ resolver: createDefaultToolResolver(registry) });
  await time('toolRuntimeExecute', 10_000, (index) => runtime.execute({ toolCallId: `c${index}`, name: 'ns150.get', arguments: { id: 'A' }, context: { runId: 'r', signal: new AbortController().signal } }));
}

// 5. Action Firewall evaluation (permission + risk + audit to an in-memory sink).
{
  const firewall = createActionFirewall({ audit: createInMemoryAuditSink() });
  const context = { identity: { subject: 'u', roles: [], permissions: ['applications.read'] }, tenant: { tenantId: 't' } };
  await time('firewallEvaluate', 10_000, (index) =>
    firewall.evaluate({ actionId: `a${index}`, runId: 'r', action: 'applications.get', arguments: { id: 'A' }, metadata: { toolName: 'applications.get', source: 'backend', risk: 'read-only', requiredPermissions: ['applications.read'] } }, context),
  );
}

// 6. RAG: permission-aware retrieval over 5,000 in-memory vectors (64 dims).
{
  const embeddings = createDeterministicEmbeddingProvider({ dimensions: 64 });
  const store = createInMemoryVectorStore();
  const texts = Array.from({ length: 5000 }, (_, index) => `document ${index} about ${['visas', 'refunds', 'payments', 'passports'][index % 4]} policy ${index % 97}`);
  const vectors = await embeddings.embedDocuments(texts);
  await store.upsert(texts.map((content, index) => ({ id: `c${index}`, chunkId: `c${index}`, documentId: `d${index}`, sourceId: 's', tenantId: index % 2 ? 'a' : 'b', content, embedding: vectors[index] ?? [], embeddingProvider: embeddings.provider, embeddingModel: embeddings.model })));
  const retriever = createRetriever({ vectorStore: store, embeddingProvider: embeddings });
  await time('ragRetrieve5000Vectors', 300, () => retriever.retrieve({ text: 'refund policy', topK: 5 }, { securityContext: { tenant: { tenantId: 'a' }, identity: { subject: 'u', roles: [], permissions: [] } } }));
}

// 7. Control plane: resolving a config snapshot with 100 resources.
{
  const service = createManagementService({ store: createInMemoryControlPlaneStore(), audit: createInMemoryAuditSink() });
  await service.createTenant({ subject: 'root', platformAdmin: true }, { id: 'acme', name: 'Acme', owner: 'o' });
  const owner = { subject: 'o', tenantId: 'acme', platformAdmin: false };
  for (let index = 0; index < 100; index += 1) await service.createResource(owner, { kind: 'rate-limit', name: `limit-${index}`, spec: { scope: 'user', limit: 60, windowMs: 60_000 } });
  await time('configSnapshot100Resources', 500, () => service.snapshot({ tenantId: 'acme' }));
}

console.log(JSON.stringify(results, null, 2));
