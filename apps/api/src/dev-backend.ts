import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import { createRuntime } from '@gixcopilot/core';
import { createDevTools } from '@gixcopilot/devtools';
import { createEvalRunner, createInMemoryEvalStore, defineEvalDataset } from '@gixcopilot/evals';
import {
  createEncryptedSecretStore,
  createInMemoryControlPlaneStore,
  createInMemorySecretRepository,
  createManagementPlugin,
  createManagementService,
} from '@gixcopilot/management';
import { createModelExecutor, createModelRuntime } from '@gixcopilot/provider';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { createActionFirewall, createInMemoryAuditSink, createStaticAuthenticationAdapter } from '@gixcopilot/security';
import type { Identity } from '@gixcopilot/security';
import { createServer } from '@gixcopilot/server';
import { createRecordingTelemetry } from '@gixcopilot/telemetry';
import { createConversationRecorder, createInMemoryConversationStore } from '@gixcopilot/tenancy';
import { createToolRegistry, defineTool } from '@gixcopilot/tools';
import { createInMemoryUsageStore, createUsageRecorder } from '@gixcopilot/usage';
import { z } from 'zod';

/**
 * DEVELOPMENT-ONLY backend for the management platform (local UI work and browser E2E) that
 * needs no PostgreSQL or Redis: the real management service and HTTP plugin over in-memory
 * stores, plus a real copilot server (mock model, labelled) whose runs populate conversations,
 * usage and traces. Fixed development tokens are for local use only; it refuses production.
 */
if (process.env['NODE_ENV'] === 'production' || process.env['AICOPILOT_ENV'] === 'production') {
  console.error('dev-backend is for development only.');
  process.exit(1);
}

const identity = (subject: string, tenantId?: string, permissions: string[] = []): Identity => ({ subject, roles: [], permissions, ...(tenantId ? { attributes: { tenantId } } : {}) });
const tokens: Record<string, Identity> = {
  'dev-owner': identity('olivia', 'acme', ['applications.read']),
  'dev-viewer': identity('vic', 'acme'),
  'dev-other': identity('gary', 'globex'),
  'dev-root': identity('root', undefined, ['platform.admin']),
};
const authentication = createStaticAuthenticationAdapter(tokens);

const store = createInMemoryControlPlaneStore();
const audit = createInMemoryAuditSink();
const conversations = createInMemoryConversationStore();
const usage = createInMemoryUsageStore();
const recording = createRecordingTelemetry({ mode: 'redacted' });
const evalStores = new Map<string, ReturnType<typeof createInMemoryEvalStore>>();
const evalStore = (tenantId: string) => evalStores.get(tenantId) ?? evalStores.set(tenantId, createInMemoryEvalStore()).get(tenantId) ?? createInMemoryEvalStore();
const jobs = new Map<string, string>();

const tools = createToolRegistry();
tools.register(
  defineTool({
    name: 'applications.get',
    description: 'Look up an application (development fixture data)',
    input: z.object({ id: z.string() }),
    security: { risk: 'read-only', requiredPermissions: ['applications.read'] },
    execute: ({ id }) => Promise.resolve({ id, status: 'under_review' }),
  }),
);
tools.register(
  defineTool({
    name: 'payments.refund',
    description: 'Refund a payment (development fixture)',
    input: z.object({ paymentId: z.string() }),
    security: { risk: 'write', approval: 'supervisor' },
    execute: ({ paymentId }) => Promise.resolve({ refunded: paymentId }),
  }),
);

const service = createManagementService({
  store,
  audit,
  auditReader: { forTenant: (scope) => ({ search: () => Promise.resolve({ items: audit.list().filter((record) => record.tenantId === scope.tenantId).reverse() }) }) },
  secrets: createEncryptedSecretStore({ repository: createInMemorySecretRepository(), keys: { v1: randomBytes(32).toString('base64') }, activeKeyVersion: 'v1' }),
  conversations,
  usage,
  traces: createDevTools({ source: recording }),
  evals: evalStore,
  jobs: {
    enqueue: (kind, _payload, options) => {
      const jobId = `${kind}__${options.idempotencyKey}`;
      const duplicate = jobs.has(jobId);
      jobs.set(jobId, 'queued');
      return Promise.resolve({ jobId, duplicate });
    },
    status: (jobId) => Promise.resolve(jobs.get(jobId) ?? 'unknown'),
  },
  catalog: {
    tools: () => tools.list().map((tool) => ({ name: tool.name, description: tool.description, risk: tool.security?.risk, approval: tool.security?.approval })),
    agents: () => [{ id: 'support', version: '1', tools: ['applications.get'], model: { provider: 'mock', model: 'dev' } }],
  },
});

const root = { subject: 'root', platformAdmin: true };
await service.createTenant(root, { id: 'acme', name: 'Acme', owner: 'olivia' });
await service.createTenant(root, { id: 'globex', name: 'Globex', owner: 'gary' });
await service.upsertMembership({ subject: 'olivia', tenantId: 'acme', platformAdmin: false }, { subject: 'vic', role: 'viewer' });

// A real copilot server whose runs feed conversations, usage and traces.
const modelRuntime = createModelRuntime({ providers: [createMockProvider({ id: 'mock', scenario: { chunks: ['Development mock answer.'], usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 } } })] });
const copilot = createServer({
  runtime: createRuntime({ executor: createModelExecutor({ runtime: modelRuntime, model: { provider: 'mock', model: 'dev' } }) }),
  modelRuntime,
  defaultModel: { provider: 'mock', model: 'dev' },
  toolRegistry: tools,
  telemetry: recording,
  authenticationAdapter: authentication,
  actionFirewall: createActionFirewall({ audit }),
  requireAuthentication: true,
  runObservers: [createConversationRecorder(conversations), createUsageRecorder({ store: usage, pricing: { version: 'dev', currency: 'USD', models: { 'mock/dev': { inputPerMillion: 5, outputPerMillion: 15 } } } })],
});
for (const threadId of ['welcome-thread', 'status-thread']) {
  await copilot.inject({ method: 'POST', url: '/runs', headers: { authorization: 'Bearer dev-owner' }, payload: { threadId, messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] } });
}
const run = await createEvalRunner({ target: () => Promise.resolve({ answer: 'Development mock answer.' }) }).run(
  defineEvalDataset({ id: 'smoke', version: '1', cases: [{ id: 'hello', input: 'hi', expected: { answerIncludes: ['answer'] } }] }),
);
await evalStore('acme').save(run);

const app = Fastify({ logger: false });
await app.register(createManagementPlugin(service, { authentication }), { prefix: '/management/v1' });
app.get('/health', () => ({ status: 'ok' }));
const port = Number(process.env['PORT'] ?? 4102);
await app.listen({ host: '127.0.0.1', port });
console.log(`dev management backend on http://127.0.0.1:${port} (tokens: dev-owner, dev-viewer, dev-other, dev-root)`);
