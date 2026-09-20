import { describe, expect, it } from 'vitest';
import { createCopilotClient } from '@gixcopilot/client';
import type { CopilotEvent } from '@gixcopilot/protocol';
import { createMockDemoBackend } from './backend.js';

describe("MCP example (Section 103's full chain, mock model)", () => {
  it('generates exactly the explicitly opted-in tools - MCP denies everything else by default', async () => {
    const backend = await createMockDemoBackend();
    try {
      expect(backend.integration.report.toolsDiscovered).toBe(3);
      expect(backend.integration.report.generated).toBe(3);
      expect(backend.integration.report.denied).toBe(0);
      expect([...backend.integration.toolNames].sort()).toEqual(
        ['mcp.widgets.getWidget', 'mcp.widgets.restockWidget', 'mcp.widgets.searchWidgets'].sort(),
      );
    } finally {
      await backend.close();
    }
  });

  it('a read tool has no approval requirement; the write tool requires approval', async () => {
    const backend = await createMockDemoBackend();
    try {
      const getWidget = backend.registry.get('mcp.widgets.getWidget');
      const restock = backend.registry.get('mcp.widgets.restockWidget');
      expect(getWidget?.security?.approval).toBe('none');
      expect(restock?.security?.approval).toBe('user-confirmation');
      expect(restock?.security?.risk).toBe('write');
    } finally {
      await backend.close();
    }
  });

  it('runs the real Model -> Generated Tool -> MCP pipeline end to end', async () => {
    const backend = await createMockDemoBackend();
    try {
      await backend.copilotServer.listen({ port: 0, host: '127.0.0.1' });
      const address = backend.copilotServer.server.address();
      if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const client = createCopilotClient({ baseUrl, getHeaders: () => ({ authorization: 'Bearer demo' }) });
      const run = client.run({
        model: { provider: 'mcp-demo-mock', model: 'demo' },
        messages: [{ role: 'user', content: [{ type: 'text', text: 'What is widget WID-1?' }] }],
      });

      const events: CopilotEvent[] = [];
      for await (const event of run.events) events.push(event);

      const toolCompleted = events.find((event) => event.type === 'tool.completed' && event.name === 'mcp.widgets.getWidget');
      expect(toolCompleted).toBeDefined();

      const text = events
        .filter((event) => event.type === 'message.delta')
        .map((event) => event.delta)
        .join('');
      expect(text).toContain('screwdriver');
      expect(events.some((event) => event.type === 'run.failed')).toBe(false);
    } finally {
      await backend.close();
    }
  }, 15_000);
});
