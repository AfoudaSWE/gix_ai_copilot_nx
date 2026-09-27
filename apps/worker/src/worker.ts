import type { CopilotConfig } from '@gixcopilot/config';
import { createJobQueue, createJobWorker, PermanentJobError } from '@gixcopilot/jobs';
import type { JobHandler, JobQueue, JobWorker } from '@gixcopilot/jobs';
import { webSource, webLoader } from '@gixcopilot/knowledge';
import type { DocumentLoader, WebSourceConfig } from '@gixcopilot/knowledge';
import type { ResourceSpec } from '@gixcopilot/management';
import { createPostgresPersistence } from '@gixcopilot/persistence-postgres';
import type { PostgresPersistence } from '@gixcopilot/persistence-postgres';
import { createIndexer, createOpenAIEmbeddingProvider, createRecursiveChunker } from '@gixcopilot/rag';
import type { EmbeddingProvider } from '@gixcopilot/rag';
import { createPgVectorStore } from '@gixcopilot/vectorstore-pgvector';
import { createUsageMeter } from '@gixcopilot/usage';

export interface CreateWorkerOptions {
  readonly config: CopilotConfig;
  /** Application handlers (e.g. `workflow.resume` with your registered workflows, `eval.run`). */
  readonly handlers?: Readonly<Record<string, JobHandler<never>>>;
  /** Defaults to OpenAI embeddings when an OpenAI key is configured. */
  readonly embeddingProvider?: EmbeddingProvider;
  /** Application-supplied loader for trusted internal sources. The default enforces the web SSRF guard. */
  readonly knowledgeLoader?: DocumentLoader<WebSourceConfig>;
  readonly persistence?: PostgresPersistence;
  readonly concurrency?: number;
  readonly now?: () => Date;
}

export interface WorkerProcess {
  readonly queue: JobQueue;
  readonly worker: JobWorker;
  readonly persistence: PostgresPersistence;
  /** Enqueues today's maintenance once (idempotent by date across every worker instance). */
  scheduleMaintenance(): Promise<void>;
  /** Graceful shutdown: finish or abort (for retry elsewhere) in-flight jobs, then close. */
  shutdown(): Promise<void>;
}

interface IndexPayload {
  readonly tenantId: string;
  readonly resourceId: string;
  readonly version: number;
}

const DAY = 86_400_000;

/**
 * The background worker (Section 57): knowledge ingestion, retention and expiry maintenance,
 * plus whatever the application registers (durable workflow resumption, eval runs). Handlers
 * are idempotent (re-indexing replaces a document partition; purges are "delete older than"),
 * so BullMQ redelivery is safe.
 */
export function createWorker(options: CreateWorkerOptions): WorkerProcess {
  const { config } = options;
  const redisUrl = config.secrets.redisUrl?.reveal();
  if (!redisUrl) throw new Error('REDIS_URL is required for the worker.');
  const databaseUrl = config.secrets.databaseUrl?.reveal();
  const persistence = options.persistence ?? createPostgresPersistence({ connectionString: databaseUrl, poolMax: config.database.poolMax });
  const connection = { url: redisUrl, maxRetriesPerRequest: null };
  const now = options.now ?? (() => new Date());
  const openaiKey = config.secrets.providerApiKeys['openai'];
  const embeddings = options.embeddingProvider ?? (openaiKey ? createOpenAIEmbeddingProvider({ apiKey: openaiKey.reveal(), dimensions: 1536 }) : undefined);
  const meter = createUsageMeter({ store: persistence.usage });

  const builtIn: Record<string, JobHandler<never>> = {
    'knowledge.index': (async (payload: IndexPayload, context) => {
      const scoped = persistence.controlPlane.forTenant(payload.tenantId);
      const resource = await scoped.getResource(payload.resourceId);
      if (!resource || resource.kind !== 'knowledge-source') throw new PermanentJobError('Knowledge source not found for this tenant.');
      const version = await scoped.getVersion(resource.id, payload.version);
      const spec = version?.spec as ResourceSpec<'knowledge-source'> | undefined;
      if (!spec) throw new PermanentJobError('Knowledge source version not found.');
      if (spec.type !== 'url' || !spec.uri) throw new PermanentJobError(`Source type "${spec.type}" needs an application-provided ingestion handler.`);
      if (!embeddings) throw new PermanentJobError('No embedding provider is configured.');
      const indexer = createIndexer({ chunker: createRecursiveChunker(), embeddingProvider: embeddings, vectorStore: createPgVectorStore({ pool: persistence.pool }) });
      // Tenant and ACL come from the control-plane record, never from the document content.
      const source = webSource({
        id: spec.sourceId,
        name: resource.name,
        tenantId: payload.tenantId,
        url: spec.uri,
        ...(spec.acl && (spec.acl.roles.length > 0 || spec.acl.subjects.length > 0) ? { acl: { roles: spec.acl.roles, users: spec.acl.subjects } } : {}),
      });
      const result = await indexer.index({ source, loader: options.knowledgeLoader ?? webLoader, context: { signal: context.signal } });
      if (result.errors.length > 0 && result.documentsIndexed === 0) throw new Error(`Indexing failed: ${result.errors.join('; ')}`);
      await meter.record({ tenantId: payload.tenantId }, { id: `index:${payload.resourceId}:${payload.version}`, kind: 'embedding', count: result.chunksEmbedded, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    }),

    'maintenance.memory-expiry': (async () => {
      await persistence.maintenance.purgeExpiredMemory(now());
    }),

    'maintenance.retention': (async () => {
      const at = now().getTime();
      const { conversationDays, auditDays, usageDays } = config.retention;
      if (conversationDays) await persistence.maintenance.purgeConversationsBefore(new Date(at - conversationDays * DAY));
      if (usageDays) await persistence.maintenance.purgeUsageBefore(new Date(at - usageDays * DAY));
      if (auditDays) {
        for (const tenant of await persistence.controlPlane.listTenants()) {
          await persistence.audit.purgeBefore({ tenantId: tenant.id }, new Date(at - auditDays * DAY));
        }
      }
    }),
  };

  const queue = createJobQueue({ connection });
  const worker = createJobWorker({ connection, concurrency: options.concurrency ?? 4, handlers: { ...builtIn, ...options.handlers } });

  return {
    queue,
    worker,
    persistence,
    async scheduleMaintenance() {
      const day = now().toISOString().slice(0, 10);
      await queue.enqueue('maintenance.memory-expiry', {}, { idempotencyKey: day });
      await queue.enqueue('maintenance.retention', {}, { idempotencyKey: day });
    },
    async shutdown() {
      await worker.close(config.service.shutdownGraceSeconds * 1000);
      await queue.close();
      if (!options.persistence) await persistence.close();
    },
  };
}
