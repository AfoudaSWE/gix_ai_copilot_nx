import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { PoolConfig } from 'pg';
import type { ConversationStore } from '@gixcopilot/tenancy';
import type { MemoryStore } from '@gixcopilot/memory';
import { createPostgresAuditSink } from './audit.js';
import type { PostgresAuditSink } from './audit.js';
import { createPostgresConversationStore } from './conversations.js';
import { createPostgresMemoryStore } from './memory.js';
import type { CreatePostgresMemoryStoreOptions } from './memory.js';
import { createMigrator } from './migrate.js';
import { createPostgresUsageStore } from './usage.js';
import { createMaintenance } from './maintenance.js';
import { createPostgresApprovalStore } from './approvals.js';
import type { ApprovalStore } from '@gixcopilot/security';
import type { Maintenance } from './maintenance.js';
import { createPostgresControlPlaneStore, createPostgresSecretRepository } from './control-plane.js';
import type { ControlPlaneStore, EncryptedSecretRepository } from '@gixcopilot/management';
import type { UsageStore } from '@gixcopilot/usage';
import type { MigrationSource, Migrator } from './migrate.js';

export interface CreatePostgresPersistenceOptions {
  readonly connectionString?: string;
  readonly pool?: Pool;
  /** Pool size per process (keep total connections under the server's limit). Default 10. */
  readonly poolMax?: number;
  readonly migrationSources?: readonly MigrationSource[];
  readonly poolConfig?: Omit<PoolConfig, 'connectionString' | 'max'>;
}

export interface DatabaseHealth {
  readonly ok: boolean;
  readonly latencyMs: number;
  /** Pending migrations (the process should not serve traffic on an old schema). */
  readonly pendingMigrations?: number;
  readonly error?: string;
}

export interface PostgresPersistence {
  readonly pool: Pool;
  readonly db: NodePgDatabase;
  readonly conversations: ConversationStore;
  readonly audit: PostgresAuditSink;
  readonly usage: UsageStore;
  readonly controlPlane: ControlPlaneStore;
  readonly secretRepository: EncryptedSecretRepository;
  /** Worker-only retention/expiry maintenance. */
  readonly maintenance: Maintenance;
  /** Durable HITL approvals shared across API instances. */
  readonly approvals: ApprovalStore;
  readonly migrator: Migrator;
  memory(options?: CreatePostgresMemoryStoreOptions): MemoryStore;
  /** A cheap `SELECT 1` plus migration status, for readiness probes. Never throws. */
  health(options?: { readonly checkMigrations?: boolean }): Promise<DatabaseHealth>;
  close(): Promise<void>;
}

/** Composes the pool, Drizzle, tenant-scoped repositories, the audit sink and the migrator. */
export function createPostgresPersistence(options: CreatePostgresPersistenceOptions): PostgresPersistence {
  const ownsPool = !options.pool;
  const pool =
    options.pool ??
    new Pool({ ...options.poolConfig, connectionString: options.connectionString, max: options.poolMax ?? 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  const db = drizzle(pool);
  const migrator = createMigrator(pool, options.migrationSources);
  return {
    pool,
    db,
    conversations: createPostgresConversationStore(db),
    audit: createPostgresAuditSink(db),
    usage: createPostgresUsageStore(db),
    controlPlane: createPostgresControlPlaneStore(db),
    secretRepository: createPostgresSecretRepository(db),
    maintenance: createMaintenance(db),
    approvals: createPostgresApprovalStore(db),
    migrator,
    memory: (memoryOptions) => createPostgresMemoryStore(db, memoryOptions),
    async health(healthOptions = {}) {
      const started = performance.now();
      try {
        await pool.query('SELECT 1');
        const pendingMigrations = healthOptions.checkMigrations
          ? (await migrator.status()).filter((migration) => !migration.applied).length
          : undefined;
        return { ok: pendingMigrations === undefined || pendingMigrations === 0, latencyMs: Math.round(performance.now() - started), ...(pendingMigrations !== undefined ? { pendingMigrations } : {}) };
      } catch (error) {
        // Only the error class/code, never the connection string.
        const code = (error as { code?: string }).code;
        return { ok: false, latencyMs: Math.round(performance.now() - started), error: code ? `database error ${code}` : 'database unreachable' };
      }
    },
    async close() {
      if (ownsPool) await pool.end();
    },
  };
}
