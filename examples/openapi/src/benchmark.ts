import { fileURLToPath } from 'node:url';
import { inspectOpenAPI, createOpenAPILoader, registerOpenAPI } from '@gixcopilot/openapi';
import { registerMCP } from '@gixcopilot/mcp';
import { createToolRegistry, toToolManifest } from '@gixcopilot/tools';
import type { IntegrationTelemetryEvent } from '@gixcopilot/tools';
import { createOpenApiSpec } from './openapi-spec.js';
import { createTestApiServer } from './test-api-server.js';

const timings: IntegrationTelemetryEvent[] = [];
const onTelemetry = (event: IntegrationTelemetryEvent) => { timings.push(event); };
const synthetic = { openapi: '3.1.0', servers: [{ url: 'https://example.com' }], paths: Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`/items/${i}`, { get: { operationId: `item${i}`, summary: 'Read an item.' } }])) };
const text = JSON.stringify(synthetic);
const loader = createOpenAPILoader({ fetchImpl: () => Promise.resolve(new Response(text)) });
const parseStart = performance.now();
await loader.load({ kind: 'url', url: 'https://example.com/spec.json' });
const parseMs = performance.now() - parseStart;
const preview = await inspectOpenAPI({ integrationId: 'catalog', source: { kind: 'object', document: synthetic }, include: Array.from({ length: 20 }, (_, i) => `item${i}`), onTelemetry });
const api = createTestApiServer();
const baseUrl = await api.listen({ port: 0, host: '127.0.0.1' });
const registry = createToolRegistry();
const integration = await registerOpenAPI({ integrationId: 'vas', namespace: 'vas', source: { kind: 'object', document: createOpenApiSpec(baseUrl) }, include: ['getApplication', 'searchApplications', 'assignApplication', 'updateApplication'], baseUrl, registry, onTelemetry });
const mcp = await registerMCP({ serverId: 'widgets', registry, transport: { kind: 'stdio', command: process.execPath, args: [fileURLToPath(new URL('../../mcp/src/mcp-server-process.mjs', import.meta.url))] }, tools: { getWidget: { permission: 'read', approval: 'none', risk: 'read-only' } }, onTelemetry });
try {
  // Trusted host benchmark of adapter latency. End-to-end authorization is measured in governance.spec.ts.
  const context = { runId: 'benchmark', signal: new AbortController().signal };
  await registry.get('vas.getApplication')?.execute({ id: 'APP-1001' }, context);
  await registry.get('mcp.widgets.getWidget')?.execute({ id: 'WID-1' }, context);
  console.log(JSON.stringify({ parseMs, syntheticReport: preview.report, modelVisibleTools: preview.tools.length, modelToolPayloadBytes: Buffer.byteLength(JSON.stringify(toToolManifest(preview.tools))), openapiReport: integration.report, mcpReport: mcp.report, timings }, null, 2));
} finally { integration.dispose(); await mcp.dispose(); await api.close(); }
