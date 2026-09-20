import { describe, expect, it } from 'vitest';
import { createCopilotClient } from '@gixcopilot/client';
import type { CopilotEvent } from '@gixcopilot/protocol';
import { createMockDemoBackend } from './backend.js';

describe("OpenAPI example (Section 103's full chain, mock model)", () => {
  it('generates exactly the tools the conservative defaults imply: GET allowed, writes need approval, DELETE hidden', async () => {
    const backend = await createMockDemoBackend();
    try {
      expect(backend.integration.report.operationsDiscovered).toBe(5);
      expect(backend.integration.report.generated).toBe(4);
      expect(backend.integration.report.denied).toBe(1); // deleteApplication - DELETE denied by default
      expect([...backend.integration.toolNames].sort()).toEqual(
        ['vas.assignApplication', 'vas.getApplication', 'vas.searchApplications', 'vas.updateApplication'].sort(),
      );
    } finally {
      await backend.close();
    }
  });

  it('a GET tool declares risk read-only with no approval override; a write tool declares risk write', async () => {
    const backend = await createMockDemoBackend();
    try {
      const getTool = backend.registry.get('vas.getApplication');
      const assignTool = backend.registry.get('vas.assignApplication');
      expect(getTool?.security?.risk).toBe('read-only');
      expect(getTool?.security?.approval).toBeUndefined();
      expect(assignTool?.security?.risk).toBe('write');
      expect(backend.registry.has('vas.deleteApplication')).toBe(false);
    } finally {
      await backend.close();
    }
  });

  it('runs the real Model -> Generated Tool -> HTTP pipeline end to end', async () => {
    const backend = await createMockDemoBackend();
    try {
      await backend.copilotServer.listen({ port: 0, host: '127.0.0.1' });
      const address = backend.copilotServer.server.address();
      if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const client = createCopilotClient({ baseUrl, getHeaders: () => ({ authorization: 'Bearer demo' }) });
      const run = client.run({
        model: { provider: 'openapi-demo-mock', model: 'demo' },
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Look up application APP-1002 for me.' }] }],
      });

      const events: CopilotEvent[] = [];
      for await (const event of run.events) events.push(event);

      const toolCompleted = events.find((event) => event.type === 'tool.completed' && event.name === 'vas.getApplication');
      expect(toolCompleted).toBeDefined();

      const text = events
        .filter((event) => event.type === 'message.delta')
        .map((event) => event.delta)
        .join('');
      expect(text).toContain('APP-1002');
      expect(events.some((event) => event.type === 'run.failed')).toBe(false);
    } finally {
      await backend.close();
    }
  });
});
