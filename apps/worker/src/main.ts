import { ConfigError, loadConfig } from '@gixcopilot/config';
import { createWorker } from './worker.js';

try {
  const config = await loadConfig({ file: process.env['AICOPILOT_CONFIG_FILE'] });
  const worker = createWorker({ config });
  await worker.worker.ready;
  await worker.scheduleMaintenance();
  const timer = setInterval(() => void worker.scheduleMaintenance().catch(() => undefined), 3_600_000);
  console.log(JSON.stringify({ level: 'info', service: 'aicopilot-worker', environment: config.environment, message: 'worker started' }));

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    console.log(JSON.stringify({ level: 'info', service: 'aicopilot-worker', message: 'shutting down', signal }));
    worker.shutdown().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : `worker startup failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(error instanceof ConfigError ? 78 : 1);
}
