import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool, PoolClient } from 'pg';
import { MIGRATIONS_TABLE } from './schema.js';

/** A directory of ordered `NNNN_name.sql` files, optionally with `NNNN_name.down.sql`. */
export interface MigrationSource {
  readonly name: string;
  readonly directory: string;
}

export interface Migration {
  /** `<source>/<file>`, e.g. `platform/0000_platform.sql`. */
  readonly id: string;
  readonly source: string;
  readonly up: string;
  readonly down?: string;
  readonly checksum: string;
}

export interface MigrationStatus {
  readonly id: string;
  readonly applied: boolean;
  readonly appliedAt?: string;
  /** The file changed after it was applied (never edit an applied migration). */
  readonly modified: boolean;
  readonly reversible: boolean;
}

const require = createRequire(import.meta.url);
const packageDirectory = (name: string): string => dirname(require.resolve(`${name}/package.json`));

/**
 * The SDK's own migrations, in dependency order: workflow checkpoints, pgvector knowledge and
 * memory embeddings (needs the `vector` extension), then the Phase 12 platform tables.
 */
export function builtInMigrationSources(options: { readonly vectors?: boolean } = {}): readonly MigrationSource[] {
  return [
    { name: 'checkpoints', directory: join(packageDirectory('@gixcopilot/checkpoint-postgres'), 'migrations') },
    ...(options.vectors === false ? [] : [{ name: 'vectors', directory: join(packageDirectory('@gixcopilot/vectorstore-pgvector'), 'migrations') }]),
    { name: 'platform', directory: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations') },
  ];
}

export async function loadMigrations(sources: readonly MigrationSource[]): Promise<readonly Migration[]> {
  const migrations: Migration[] = [];
  for (const source of sources) {
    const files = (await readdir(source.directory)).filter((file) => /^\d{4}_[\w-]+\.sql$/.test(file) && !file.endsWith('.down.sql')).sort();
    for (const file of files) {
      const up = await readFile(join(source.directory, file), 'utf8');
      const down = await readFile(join(source.directory, file.replace(/\.sql$/, '.down.sql')), 'utf8').catch(() => undefined);
      migrations.push({ id: `${source.name}/${file}`, source: source.name, up, down, checksum: createHash('sha256').update(up).digest('hex') });
    }
  }
  return migrations;
}

// Arbitrary constant: one migration run at a time across every instance.
const LOCK_KEY = 7_312_024_001;

function statements(sql: string): string[] {
  return sql.split('--> statement-breakpoint').map((statement) => statement.trim()).filter((statement) => statement.length > 0);
}

async function withLock<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    return await work(client);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

async function applied(client: PoolClient): Promise<Map<string, { checksum: string; appliedAt: string }>> {
  const result = await client.query<{ id: string; checksum: string; applied_at: Date }>(`SELECT id, checksum, applied_at FROM ${MIGRATIONS_TABLE}`);
  return new Map(result.rows.map((row) => [row.id, { checksum: row.checksum, appliedAt: row.applied_at.toISOString() }]));
}

export interface Migrator {
  status(): Promise<readonly MigrationStatus[]>;
  /** Applies pending migrations in order, each in its own transaction. Refuses to run when an
   * applied migration was modified. Returns the ids applied. */
  up(): Promise<readonly string[]>;
  /** Reverts the most recently applied migration using its reviewed `.down.sql`; refuses when
   * there is none. Destructive by nature: never called automatically. */
  rollbackLast(): Promise<string | undefined>;
}

/**
 * The migration runner behind `aicopilot db migrate` (generate with drizzle-kit, review the SQL,
 * apply here). Application startup should only *check* `status()`; applying is a separate,
 * explicit deployment step (Section 52).
 */
export function createMigrator(pool: Pool, sources: readonly MigrationSource[] = builtInMigrationSources()): Migrator {
  const load = () => loadMigrations(sources);
  return {
    async status() {
      const migrations = await load();
      return withLock(pool, async (client) => {
        const done = await applied(client);
        return migrations.map((migration) => {
          const row = done.get(migration.id);
          return {
            id: migration.id,
            applied: Boolean(row),
            appliedAt: row?.appliedAt,
            modified: Boolean(row && row.checksum !== migration.checksum),
            reversible: migration.down !== undefined,
          };
        });
      });
    },
    async up() {
      const migrations = await load();
      return withLock(pool, async (client) => {
        const done = await applied(client);
        const modified = migrations.filter((migration) => {
          const row = done.get(migration.id);
          return row && row.checksum !== migration.checksum;
        });
        if (modified.length > 0) {
          throw new Error(`Refusing to migrate: applied migrations were modified: ${modified.map((migration) => migration.id).join(', ')}`);
        }
        const ran: string[] = [];
        for (const migration of migrations) {
          if (done.has(migration.id)) continue;
          await client.query('BEGIN');
          try {
            for (const statement of statements(migration.up)) await client.query(statement);
            await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (id, checksum) VALUES ($1, $2)`, [migration.id, migration.checksum]);
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK');
            throw new Error(`Migration ${migration.id} failed and was rolled back: ${(error as Error).message}`);
          }
          ran.push(migration.id);
        }
        return ran;
      });
    },
    async rollbackLast() {
      const migrations = await load();
      return withLock(pool, async (client) => {
        const result = await client.query<{ id: string }>(`SELECT id FROM ${MIGRATIONS_TABLE} ORDER BY applied_at DESC, id DESC LIMIT 1`);
        const last = result.rows[0]?.id;
        if (!last) return undefined;
        const migration = migrations.find((candidate) => candidate.id === last);
        if (!migration?.down) throw new Error(`Migration ${last} has no reviewed .down.sql; restore from backup instead.`);
        await client.query('BEGIN');
        try {
          for (const statement of statements(migration.down)) await client.query(statement);
          await client.query(`DELETE FROM ${MIGRATIONS_TABLE} WHERE id = $1`, [last]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
        return last;
      });
    },
  };
}
