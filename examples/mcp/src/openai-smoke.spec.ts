// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createCopilotClient } from '@gixcopilot/client';
import type { CopilotEvent } from '@gixcopilot/protocol';
import { createOpenAiDemoBackend, resolveOpenAiConfig } from './backend.js';

/**
 * Section 141's real-provider validation: OpenAI -> generated MCP tool. Only runs when
 * `OPENAI_API_KEY` is set; otherwise SKIPPED, never FAILED (mirrors
 * `examples/openapi/src/openai-smoke.spec.ts` and `examples/react-generative-ui`'s). Makes
 * real network calls to OpenAI's API and costs real (tiny) money when it runs.
 *
 * Run explicitly with:
 *   OPENAI_API_KEY=sk-... pnpm --filter @gixcopilot/example-mcp test -- openai-smoke
 */
const apiKey = process.env['RUN_OPENAI_SMOKE'] === '1' && process.env['OPENAI_API_KEY'];

describe.skipIf(!apiKey)('real OpenAI -> generated MCP tool (requires OPENAI_API_KEY, real network calls)', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('the model selects and calls the generated mcp.widgets.getWidget tool over a real MCP server process', async () => {
    const backend = await createOpenAiDemoBackend(resolveOpenAiConfig());
    close = () => backend.close();

    await backend.copilotServer.listen({ port: 0, host: '127.0.0.1' });
    const address = backend.copilotServer.server.address();
    if (address === null || typeof address === 'string') throw new Error('Expected the server to bind to a TCP address.');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const client = createCopilotClient({ baseUrl, getHeaders: () => ({ authorization: 'Bearer demo' }) });
    const run = client.run({
      model: { provider: 'openai', model: process.env['OPENAI_MODEL'] || 'gpt-4o-mini' },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Call the getWidget tool for widget id WID-1 and describe it.' }] }],
    });

    const events: CopilotEvent[] = [];
    for await (const event of run.events) events.push(event);

    const toolCompleted = events.find((event) => event.type === 'tool.completed' && event.name === 'mcp.widgets.getWidget');
    expect(toolCompleted).toBeDefined();
    expect(events.some((event) => event.type === 'run.failed')).toBe(false);

    const text = events
      .filter((event) => event.type === 'message.delta')
      .map((event) => event.delta)
      .join('');
    expect(text.toLowerCase()).toContain('screwdriver');
  }, 30_000);
});

if (!apiKey) {
  console.log('[openai-smoke] SKIPPED: OPENAI_API_KEY is not set.');
}
