// @vitest-environment node
//
// This suite starts a real server (fastify + a real `openai` client) and talks to it over
// real HTTP - it must run under Node, not this project's default jsdom environment (needed
// for `integration.spec.tsx`'s React rendering). The `openai` SDK actively refuses to
// initialize under a browser-like global scope (Section 14's API-key-safety guard) - jsdom
// trips that guard even though nothing here ever runs in an actual browser.
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createCopilotClient } from '@gixcopilot/client';
import type { CopilotEvent } from '@gixcopilot/protocol';
import { createOpenAiDemoServer, resolveOpenAiConfig } from './backend.js';

/**
 * Section 53's optional real-provider smoke test. Opt-in: only runs when RUN_OPENAI_SMOKE=1
 * and OPENAI_API_KEY are both set, so a key already present in a developer's shell never
 * turns `pnpm validate` into a paid, network-dependent run. Otherwise SKIPPED, never FAILED,
 * and never part of the deterministic CI requirement (see `integration.spec.tsx`, which
 * always uses the mock backend). Makes real network calls to OpenAI's API and costs real
 * (tiny) money when it runs.
 *
 * Run explicitly with:
 *   RUN_OPENAI_SMOKE=1 OPENAI_API_KEY=sk-... pnpm --filter @gixcopilot/react-generative-ui test -- openai-smoke
 */
const apiKey =
  process.env['RUN_OPENAI_SMOKE'] === '1' ? process.env['OPENAI_API_KEY'] : undefined;

async function startRealServer(): Promise<{ app: FastifyInstance; baseUrl: string }> {
  const app = createOpenAiDemoServer(resolveOpenAiConfig());
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected the test server to bind to a TCP address.');
  }
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe.skipIf(!apiKey)(
  'real OpenAI end-to-end smoke test (requires OPENAI_API_KEY, real network calls)',
  () => {
    let app: FastifyInstance | undefined;

    afterEach(async () => {
      await app?.close();
      app = undefined;
    });

    it('streams a real completion through the demo server over real HTTP', async () => {
      const started = await startRealServer();
      app = started.app;

      const client = createCopilotClient({ baseUrl: started.baseUrl });
      const run = client.run({
        model: { provider: 'openai', model: process.env['OPENAI_MODEL'] || 'gpt-4o-mini' },
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Reply with exactly the word: pong' }] },
        ],
      });

      const events: CopilotEvent[] = [];
      for await (const event of run.events) events.push(event);

      expect(events.filter((event) => event.type === 'message.delta').length).toBeGreaterThan(0);
      expect(events.at(-1)?.type).toBe('run.completed');
    }, 30_000);

    it('calls the real applications.getStatus tool through the full Tool Runtime pipeline', async () => {
      const started = await startRealServer();
      app = started.app;

      const client = createCopilotClient({ baseUrl: started.baseUrl });
      const run = client.run({
        model: { provider: 'openai', model: process.env['OPENAI_MODEL'] || 'gpt-4o-mini' },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Call the applications.getStatus tool for application id APP-1024 and tell me its status.',
              },
            ],
          },
        ],
      });

      const events: CopilotEvent[] = [];
      for await (const event of run.events) events.push(event);

      const toolCompleted = events.find(
        (event) => event.type === 'tool.completed' && event.name === 'applications.getStatus',
      );
      expect(toolCompleted).toBeDefined();
      expect(events.some((event) => event.type === 'run.failed')).toBe(false);
    }, 30_000);
  },
);

if (!apiKey) {
  console.log('[openai-smoke] SKIPPED: set RUN_OPENAI_SMOKE=1 and OPENAI_API_KEY to run.');
}
