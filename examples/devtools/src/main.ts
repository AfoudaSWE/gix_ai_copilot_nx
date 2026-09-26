import { createDevToolsDemo } from './backend.js';
import { runScenario } from './scenario.js';

/**
 * Starts the demo app with DevTools ENABLED for local development (Section 157).
 *   pnpm --filter @gixcopilot/devtools-demo start        then open apps/devtools (pnpm dev)
 *   SEED_SCENARIO=1 ...                                  pre-populate a realistic session
 *   MODEL_PROVIDER=openai OPENAI_API_KEY=sk-... ...      real OpenAI instead of scripted models
 */
async function main(): Promise<void> {
  const port = Number(process.env['PORT'] ?? 4100);
  const token = process.env['DEVTOOLS_TOKEN'] ?? 'local-dev-token';
  const apiKey = process.env['OPENAI_API_KEY'];
  const live = process.env['MODEL_PROVIDER'] === 'openai' && apiKey ? { apiKey, model: process.env['OPENAI_MODEL'] || 'gpt-4o-mini' } : undefined;
  const demo = await createDevToolsDemo({ live, devtools: { enabled: true, token } });
  if (process.env['SEED_SCENARIO'] === '1') {
    const result = await runScenario(demo);
    console.log(`Seeded a session: agents ${result.agentStatus}, workflow ${result.workflowStatus}.`);
  }
  await demo.app.listen({ port, host: '127.0.0.1' });
  console.log(`Demo app on http://127.0.0.1:${port} (${live ? `OpenAI ${live.model}` : 'scripted models'})`);
  console.log(`DevTools API: http://127.0.0.1:${port}/devtools/session  (Authorization: Bearer ${token === 'local-dev-token' ? token : '<DEVTOOLS_TOKEN>'})`);
  console.log('DevTools UI:  pnpm --filter @gixcopilot/devtools-app dev  (proxies /devtools to this port)');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
