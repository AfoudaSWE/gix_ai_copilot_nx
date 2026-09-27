import { Redis } from 'ioredis';
import type { CopilotConfig } from '@gixcopilot/config';
import { createRuntime } from '@gixcopilot/core';
import { createDevTools } from '@gixcopilot/devtools';
import { createInMemoryEvalStore } from '@gixcopilot/evals';
import type { EvalStore } from '@gixcopilot/evals';
import { createJobQueue } from '@gixcopilot/jobs';
import type { JobQueue } from '@gixcopilot/jobs';
import { createEncryptedSecretStore, createManagementPlugin, createManagementService, createSnapshotCache } from '@gixcopilot/management';
import { createModelRouter, createProviderHealth, createRoutedModelRuntime } from '@gixcopilot/model-router';
import { createPostgresPersistence } from '@gixcopilot/persistence-postgres';
import type { PostgresPersistence } from '@gixcopilot/persistence-postgres';
import { createModelExecutor, createModelRuntime } from '@gixcopilot/provider';
import type { ModelProvider } from '@gixcopilot/provider';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';
import { createMemoryRateLimiter, createRedisRateLimiter, redisHealth } from '@gixcopilot/redis';
import { createActionFirewall } from '@gixcopilot/security';
import type { AuthenticationAdapter } from '@gixcopilot/security';
import { createMetricsRegistry, createRunMetricsObserver, createServer, registerOperationalRoutes } from '@gixcopilot/server';
import type { RunObserver } from '@gixcopilot/server';
import { composeTelemetry, createOpenTelemetryAdapter, createRatioSampler, createRecordingTelemetry } from '@gixcopilot/telemetry';
import { createConversationRecorder } from '@gixcopilot/tenancy';
import { createToolRegistry } from '@gixcopilot/tools';
import type { AnyToolDefinition } from '@gixcopilot/tools';
import { createUsageRecorder } from '@gixcopilot/usage';
import type { PricingTable } from '@gixcopilot/usage';
import { createJwtAuthenticationAdapter } from './auth.js';
import { createSnapshotPolicyAdmission } from './policies.js';

export interface CreateApiServerOptions {
  readonly config: CopilotConfig;
  /** Application tools (the reference server ships none). Each is still firewall-checked. */
  readonly tools?: readonly AnyToolDefinition[];
  /** Replace the reference JWT authentication with your own adapter. */
  readonly authentication?: AuthenticationAdapter;
  /** Extra model providers (e.g. an internal gateway). */
  readonly providers?: readonly ModelProvider[];
  readonly pricing?: PricingTable;
  /** Injected for tests; otherwise created from `config.secrets.databaseUrl`. */
  readonly persistence?: PostgresPersistence;
  readonly evalStore?: (tenantId: string) => EvalStore;
}

export interface ApiServer {
  readonly app: ReturnType<typeof createServer>;
  readonly persistence: PostgresPersistence;
  readonly jobs?: JobQueue;
  /** Graceful shutdown: stop readiness, drain in-flight requests, then close DB and Redis. */
  shutdown(): Promise<void>;
}

/**
 * Builds the production API server from validated configuration: data plane (runs, tools,
 * firewall, usage policies, conversation/usage recording) plus, when enabled, the control
 * plane (management API). Migrations are NOT applied here; readiness reports them as pending.
 */
export async function createApiServer(options: CreateApiServerOptions): Promise<ApiServer> {
  const { config } = options;
  const databaseUrl = config.secrets.databaseUrl?.reveal();
  if (!options.persistence && !databaseUrl) throw new Error('DATABASE_URL is required.');
  const persistence = options.persistence ?? createPostgresPersistence({ connectionString: databaseUrl, poolMax: config.database.poolMax });
  const redisUrl = config.secrets.redisUrl?.reveal();
  const redis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: false }) : undefined;
  const jobs = redisUrl ? createJobQueue({ connection: { url: redisUrl, maxRetriesPerRequest: null } }) : undefined;

  // Model providers: keys come from resolved secrets only; the mock is refused outside dev/test by config validation.
  const providers: ModelProvider[] = [...(options.providers ?? [])];
  const openaiKey = config.secrets.providerApiKeys['openai'];
  if (openaiKey) providers.push(createOpenAIProvider({ apiKey: openaiKey.reveal(), baseURL: config.models.providers['openai']?.baseUrl }));
  if (config.environment === 'development' || config.environment === 'test') {
    providers.push(createMockProvider({ id: 'mock', scenario: { chunks: ['This is the development mock provider. Configure a real provider for real answers.'], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } }));
  }
  const defaultModel = config.models.default ?? (config.environment === 'production' || config.environment === 'staging' ? undefined : { provider: 'mock', model: 'dev' });
  if (!defaultModel) throw new Error('models.default is required (AICOPILOT_MODEL_PROVIDER / AICOPILOT_MODEL).');
  const health = createProviderHealth();
  const modelRuntime = createRoutedModelRuntime({
    runtime: createModelRuntime({ providers }),
    router: createModelRouter({
      catalog: [{ ...defaultModel, capabilities: { streaming: true, tools: true, structuredOutput: false, vision: false, contextWindow: 128_000 } }],
      strategy: { type: 'fixed', model: defaultModel },
      health,
    }),
    health,
  });

  // Telemetry: OpenTelemetry API (export via the host's OTel SDK/collector) + a redacted
  // in-memory recording for the platform's trace views (this instance only).
  const recording = createRecordingTelemetry({ mode: config.telemetry.mode, shouldSample: createRatioSampler(config.telemetry.traceSampleRatio) });
  const telemetry = composeTelemetry([createOpenTelemetryAdapter(), recording]);
  const devtools = createDevTools({ source: recording });

  const authentication =
    options.authentication ??
    (config.secrets.jwtSecret
      ? createJwtAuthenticationAdapter({ secret: config.secrets.jwtSecret.reveal(), issuer: config.security.jwt.issuer, audience: config.security.jwt.audience })
      : undefined);
  if (config.security.requireAuthentication && !authentication) throw new Error('requireAuthentication is on but no authentication is configured (AICOPILOT_JWT_SECRET or a custom adapter).');

  const toolRegistry = createToolRegistry();
  for (const tool of options.tools ?? []) toolRegistry.register(tool);
  const limiter = redis ? createRedisRateLimiter(redis) : createMemoryRateLimiter();
  const evalStores = new Map<string, EvalStore>();
  const evalStore = options.evalStore ?? ((tenantId: string) => evalStores.get(tenantId) ?? evalStores.set(tenantId, createInMemoryEvalStore()).get(tenantId) as EvalStore);

  const service = createManagementService({
    store: persistence.controlPlane,
    audit: persistence.audit,
    auditReader: persistence.audit,
    ...(config.secrets.managementSecretKey
      ? { secrets: createEncryptedSecretStore({ repository: persistence.secretRepository, keys: { v1: config.secrets.managementSecretKey.reveal() }, activeKeyVersion: 'v1' }) }
      : {}),
    conversations: persistence.conversations,
    usage: persistence.usage,
    traces: devtools,
    evals: evalStore,
    ...(jobs ? { jobs } : {}),
    catalog: {
      tools: () => toolRegistry.list().map((tool) => ({ name: tool.name, description: tool.description, source: tool.metadata?.source, risk: tool.security?.risk, approval: tool.security?.approval })),
    },
  });
  const snapshots = createSnapshotCache({ load: (scope) => service.snapshot(scope), ttlMs: 15_000 });
  const metricsRegistry = createMetricsRegistry();
  const observers: RunObserver[] = [
    createConversationRecorder(persistence.conversations),
    createUsageRecorder({ store: persistence.usage, pricing: options.pricing }),
    createRunMetricsObserver(metricsRegistry),
  ];

  const app = createServer({
    runtime: createRuntime({ executor: createModelExecutor({ runtime: modelRuntime, model: defaultModel }) }),
    modelRuntime,
    defaultModel,
    toolRegistry,
    telemetry,
    authenticationAdapter: authentication,
    actionFirewall: createActionFirewall({ audit: persistence.audit }),
    approvals: persistence.approvals,
    requireAuthentication: config.security.requireAuthentication,
    admission: createSnapshotPolicyAdmission({ snapshot: (scope) => snapshots.get(scope), store: persistence.usage, limiter }),
    runObservers: observers,
    logger: {
      level: config.service.logLevel,
      base: { service: config.service.name, environment: config.environment },
      // Structured logs never carry credentials (Section 112).
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]'], censor: '[redacted]' },
    },
  });

  if (config.management.enabled) {
    await app.register(createManagementPlugin(service, { authentication: authentication ?? { authenticate: () => Promise.resolve(null) } }), { prefix: '/management/v1' });
  }

  let shuttingDown = false;
  registerOperationalRoutes(app, {
    isShuttingDown: () => shuttingDown,
    readiness: [
      { name: 'database', check: () => persistence.health({ checkMigrations: true }).then((result) => ({ ok: result.ok, ...(result.error ? { error: result.error } : result.pendingMigrations ? { error: `${result.pendingMigrations} pending migrations` } : {}) })) },
      ...(redis ? [{ name: 'redis', check: () => redisHealth(redis) }] : []),
    ],
    ...(config.telemetry.metricsEnabled ? { metrics: { registry: metricsRegistry, bearerToken: config.secrets.metricsToken?.reveal() } } : {}),
  });

  return {
    app,
    persistence,
    ...(jobs ? { jobs } : {}),
    async shutdown() {
      shuttingDown = true;
      await app.close(); // stops accepting, waits for in-flight streams and run observers
      await jobs?.close();
      await redis?.quit().catch(() => undefined);
      if (!options.persistence) await persistence.close();
    },
  };
}
