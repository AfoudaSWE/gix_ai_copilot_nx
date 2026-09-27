import { ConfigError, describeConfig, loadConfig } from '@gixcopilot/config';
import { createApiServer } from './bootstrap.js';

/**
 * Production entry point. Configuration is validated before anything starts (Section 119):
 * a missing DATABASE_URL, weak production settings or an unresolvable secret stop the process
 * with a clear list of problems (paths only, no values).
 */
try {
  const config = await loadConfig({ file: process.env['AICOPILOT_CONFIG_FILE'] });
  const server = await createApiServer({ config });
  server.app.log.info({ config: describeConfig(config) }, 'configuration loaded');
  await server.app.listen({ host: config.service.host, port: config.service.port });

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    server.app.log.info({ signal }, 'shutting down');
    const deadline = setTimeout(() => {
      server.app.log.error('graceful shutdown timed out');
      process.exit(1);
    }, config.service.shutdownGraceSeconds * 1000);
    deadline.unref();
    server.shutdown().then(
      () => process.exit(0),
      (error: unknown) => {
        server.app.log.error({ err: error }, 'shutdown failed');
        process.exit(1);
      },
    );
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(78); // EX_CONFIG
  }
  console.error('startup failed:', error instanceof Error ? error.message : 'unknown error');
  process.exit(1);
}
