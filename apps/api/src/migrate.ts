import { ConfigError, loadConfig } from '@gixcopilot/config';
import { createPostgresPersistence } from '@gixcopilot/persistence-postgres';

/**
 * One-shot deployment step: applies pending, reviewed migrations and exits. Run it before
 * rolling out new API/worker versions (docker compose runs it as the `migrate` service); the
 * servers themselves never migrate at startup.
 */
try {
  const config = await loadConfig({ file: process.env['AICOPILOT_CONFIG_FILE'] });
  const url = config.secrets.databaseUrl?.reveal();
  if (!url) throw new Error('DATABASE_URL is required.');
  const persistence = createPostgresPersistence({ connectionString: url, poolMax: 1 });
  try {
    const applied = await persistence.migrator.up();
    console.log(JSON.stringify({ level: 'info', service: 'aicopilot-migrate', applied }));
  } finally {
    await persistence.close();
  }
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : `migration failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
}
