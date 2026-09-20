// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createCopilotClient } from '@gixcopilot/client';
import type { CopilotEvent } from '@gixcopilot/protocol';
import { createOpenAiDemoBackend, resolveOpenAiConfig } from './backend.js';

/**
 * Section 141's real-provider validation: OpenAI -> generated OpenAPI tool. Only runs when
 * `OPENAI_API_KEY` is set; otherwise SKIPPED, never FAILED (mirrors
 * `examples/react-generative-ui/src/openai-smoke.spec.ts` exactly). Makes real network calls
 * to OpenAI's API and costs real (tiny) money when it runs.
 *
 * Run explicitly with:
 *   OPENAI_API_KEY=sk-... pnpm --filter @gixcopilot/example-openapi test -- openai-smoke
 */
const apiKey = process.env['RUN_OPENAI_SMOKE'] === '1' && process.env['OPENAI_API_KEY'];

describe.skipIf(!apiKey)('real OpenAI -> generated OpenAPI tool (requires OPENAI_API_KEY, real network calls)', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('the model selects and calls the generated vas.getApplication tool, and the answer reflects the real HTTP response', async () => {
    const backend = await createOpenAiDemoBackend(resolveOpenAiConfig());
    close = () => backend.close();

    await backend.copilotServer.listen({ port: 0, host: '127.0.0.1' });
    const address = backend.copilotServer.server.address();
    if (address === null || typeof address === 'string') throw new Error('Expected the server to bind to a TCP address.');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const client = createCopilotClient({ baseUrl, getHeaders: () => ({ authorization: 'Bearer demo' }) });
    const run = client.run({
      model: { provider: 'openai', model: process.env['OPENAI_MODEL'] || 'gpt-4o-mini' },
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Call the getApplication tool for application id APP-1002 and tell me the applicant name.' }],
        },
      ],
    });

    const events: CopilotEvent[] = [];
    for await (const event of run.events) events.push(event);

    const toolCompleted = events.find((event) => event.type === 'tool.completed' && event.name === 'vas.getApplication');
    expect(toolCompleted).toBeDefined();
    expect(events.some((event) => event.type === 'run.failed')).toBe(false);

    const text = events
      .filter((event) => event.type === 'message.delta')
      .map((event) => event.delta)
      .join('');
    expect(text.toLowerCase()).toContain('hopper');
  }, 30_000);

  it('waits for approval before a real-model generated POST and continues afterward', async () => {
    const backend = await createOpenAiDemoBackend(resolveOpenAiConfig());
    close = () => backend.close();
    const address = await backend.copilotServer.listen({ port: 0, host: '127.0.0.1' });
    const client = createCopilotClient({ baseUrl: address, getHeaders: () => ({ authorization: 'Bearer demo' }) });
    let approved = false;
    const events: CopilotEvent[] = [];
    for await (const event of client.run({ model: { provider: 'openai', model: process.env['OPENAI_MODEL'] || 'gpt-4o-mini' }, messages: [
      { role: 'user', content: [{ type: 'text', text: 'Call assignApplication now to assign application APP-1001 to officer OFF-B. After the tool returns, confirm the assigned officer.' }] },
    ] }).events) {
      events.push(event);
      if (event.type === 'approval.requested') {
        expect((await backend.apiServer.inject('/applications/APP-1001')).json<{ assignedOfficerId?: string }>().assignedOfficerId).toBeUndefined();
        await client.decideApproval(event.approvalId, 'approve'); approved = true;
      }
    }
    expect(approved).toBe(true);
    expect(events.some((event) => event.type === 'tool.completed' && event.name === 'vas.assignApplication')).toBe(true);
    expect(events.some((event) => event.type === 'run.failed')).toBe(false);
    expect((await backend.apiServer.inject('/applications/APP-1001')).json<{ assignedOfficerId?: string }>().assignedOfficerId).toBe('OFF-B');
    expect(events.some((event) => event.type === 'message.delta')).toBe(true);
  }, 60_000);

});

if (!apiKey) {
  console.log('[openai-smoke] SKIPPED: OPENAI_API_KEY is not set.');
}
