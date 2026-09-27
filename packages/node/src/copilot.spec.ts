import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createCopilotClient } from '@gixcopilot/client';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { createActionFirewall, createInMemoryAuditSink, createStaticAuthenticationAdapter } from '@gixcopilot/security';
import type { Identity } from '@gixcopilot/security';
import { defineTool } from '@gixcopilot/tools';
import { createCopilot } from './index.js';
import type { Copilot } from './index.js';

const copilots: Copilot[] = [];
afterEach(async () => {
  await Promise.all(copilots.splice(0).map((copilot) => copilot.close()));
});

function track(copilot: Copilot): Copilot {
  copilots.push(copilot);
  return copilot;
}

const officer: Identity = { subject: 'officer', roles: [], permissions: ['applications.read'], attributes: { tenantId: 'acme' } };
const guest: Identity = { subject: 'guest', roles: [], permissions: [], attributes: { tenantId: 'acme' } };

describe('@gixcopilot/node', () => {
  it('runs a turn in-process through the real server pipeline with a server-chosen model', async () => {
    const copilot = track(
      createCopilot({
        model: { provider: 'mock', model: 'demo' },
        providers: [createMockProvider({ id: 'mock', scenario: { chunks: ['Hello', ' from', ' Node'] } })],
      }),
    );
    const result = await copilot.run('Hi');
    expect(result.status).toBe('completed');
    expect(result.text).toBe('Hello from Node');
    expect(result.events[0]?.type).toBe('run.started');

    const streamed: string[] = [];
    for await (const event of copilot.stream('Again')) streamed.push(event.type);
    expect(streamed).toContain('message.delta');
    expect(streamed.at(-1)).toBe('run.completed');
  });

  it('backend tools go through authentication and the Action Firewall (no bypass in-process)', async () => {
    let executions = 0;
    const audit = createInMemoryAuditSink();
    const lookup = defineTool({
      name: 'applications.get',
      description: 'Get an application',
      input: z.object({ id: z.string() }),
      security: { risk: 'read-only', requiredPermissions: ['applications.read'] },
      execute: ({ id }) => {
        executions += 1;
        return Promise.resolve({ id, status: 'under_review' });
      },
    });
    const provider = createMockProvider({
      id: 'mock',
      scenario: (attempt) =>
        attempt === 1
          ? { toolCalls: [{ id: 'call-1', name: 'applications.get', arguments: { id: 'APP-1' } }] }
          : { chunks: ['It is under review.'] },
    });
    const copilot = track(
      createCopilot({
        model: { provider: 'mock', model: 'demo' },
        providers: [provider],
        tools: [lookup],
        security: {
          authentication: createStaticAuthenticationAdapter({ officer, guest }),
          firewall: createActionFirewall({ audit }),
        },
      }),
    );

    const allowed = await copilot.run({ messages: [{ role: 'user', content: [{ type: 'text', text: 'Status of APP-1?' }] }], headers: { authorization: 'Bearer officer' } });
    expect(allowed.status).toBe('completed');
    expect(executions).toBe(1);
    expect(audit.list().some((record) => record.decision === 'execution.completed')).toBe(true);

    // A caller without the permission never gets the tool executed.
    const denied = await copilot.run({ messages: [{ role: 'user', content: [{ type: 'text', text: 'Status of APP-1?' }] }], headers: { authorization: 'Bearer guest' } });
    expect(executions).toBe(1);
    expect(denied.events.some((event) => event.type === 'tool.completed')).toBe(false);
  });

  it('serves real HTTP through nodeHandler() for node:http / Express', async () => {
    const copilot = track(
      createCopilot({
        model: { provider: 'mock', model: 'demo' },
        providers: [createMockProvider({ id: 'mock', scenario: { chunks: ['over', ' http'] } })],
      }),
    );
    const server = createHttpServer(copilot.nodeHandler());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const client = createCopilotClient({ baseUrl: `http://127.0.0.1:${port}` });
      let text = '';
      for await (const event of client.run({ messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] }).events) {
        if (event.type === 'message.delta') text += event.delta;
      }
      expect(text).toBe('over http');
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(await health.json()).toEqual({ status: 'ok' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('cancels an in-process run through the same cancel route', async () => {
    const copilot = track(
      createCopilot({
        model: { provider: 'mock', model: 'demo' },
        providers: [createMockProvider({ id: 'mock', scenario: { chunks: Array.from({ length: 50 }, () => 'x'), delayMsPerChunk: 20 } })],
      }),
    );
    const controller = new AbortController();
    const seen: string[] = [];
    for await (const event of copilot.stream({ messages: [{ role: 'user', content: [{ type: 'text', text: 'long' }] }], signal: controller.signal })) {
      seen.push(event.type);
      if (event.type === 'message.delta') controller.abort();
    }
    expect(seen.filter((type) => type === 'message.delta').length).toBeLessThan(50);
  });
});
