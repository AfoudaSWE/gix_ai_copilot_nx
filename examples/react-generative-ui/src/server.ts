import { createOpenAiDemoServer, resolveOpenAiConfig } from './backend.js';
import type { OpenAiConfig } from './backend.js';

/**
 * The real demo entry point (`pnpm server`) - always talks to real OpenAI, never the mock
 * provider (Section 1, 32). Fails fast and obviously when misconfigured (Section 6-7)
 * instead of silently falling back to a mock/deterministic response, which would hide a
 * real integration problem behind an apparently-working demo.
 */
let config: OpenAiConfig;
try {
  config = resolveOpenAiConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const app = createOpenAiDemoServer(config);
await app.listen({ host: '127.0.0.1', port: 4321 });
console.log('Copilot generative-UI demo (real OpenAI) listening at http://127.0.0.1:4321');
console.log(`Model: ${config.model}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close();
  });
