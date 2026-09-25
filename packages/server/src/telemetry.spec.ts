import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createEchoExecutor, createRuntime } from '@gixcopilot/core';
import { createModelRuntime } from '@gixcopilot/provider';
import type { ModelProvider } from '@gixcopilot/provider';
import { createToolRegistry, defineTool } from '@gixcopilot/tools';
import { createActionFirewall, createStaticAuthenticationAdapter } from '@gixcopilot/security';
import { createRecordingTelemetry } from '@gixcopilot/telemetry';
import { createServer } from './app.js';

const payload = {
  model: { provider: 'mock', model: 'test' },
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Find the item' }] }],
};

function provider(): ModelProvider {
  let calls = 0;
  return {
    id: 'mock',
    async *stream() {
      await Promise.resolve();
      calls += 1;
      if (calls === 1) {
        yield { type: 'tool_call.requested', toolCall: { id: 'call-1', name: 'items.get', arguments: { id: '1' } } };
        yield { type: 'model.completed', finishReason: 'tool_calls' };
      } else {
        yield { type: 'content.delta', delta: 'Found' };
        yield { type: 'model.completed', finishReason: 'stop' };
      }
    },
  };
}

describe('server telemetry', () => {
  let app: ReturnType<typeof createServer> | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('records the real SSE stream and nested model and tool work', async () => {
    const telemetry = createRecordingTelemetry({ mode: 'redacted' });
    const toolRegistry = createToolRegistry();
    toolRegistry.register(defineTool({ name: 'items.get', description: 'Read item', input: z.object({ id: z.string() }), execute: ({ id }) => Promise.resolve({ id }) }));
    app = createServer({ runtime: createRuntime({ executor: createEchoExecutor() }), modelRuntime: createModelRuntime({ providers: [provider()] }), toolRegistry, telemetry });
    const response = await app.inject({ method: 'POST', url: '/runs', payload });
    expect(response.statusCode).toBe(200);
    const session = telemetry.session();
    const events = session.events.filter((event) => event.type === 'protocol.event');
    const runId = events[0]?.correlation.runId;
    expect(runId).toBeDefined();
    expect(events.map((event) => event.event.type)).toContain('run.completed');
    for (const type of ['model.call', 'tool.execution', 'run']) {
      expect(session.events.some((event) => event.type === type && event.correlation.runId === runId)).toBe(true);
    }
    const root = session.spans.find((span) => span.name === 'copilot.run');
    expect(root).toBeDefined();
    for (const name of ['model.call', 'tool.execute']) {
      expect(session.spans.some((span) => span.name === name && span.parentSpanId === root?.spanId)).toBe(true);
    }
  });

  it('records a firewall denial using the firewall reason code', async () => {
    const telemetry = createRecordingTelemetry({ mode: 'redacted' });
    const toolRegistry = createToolRegistry();
    toolRegistry.register(defineTool({ name: 'items.get', description: 'Read item', input: z.object({ id: z.string() }), security: { requiredPermissions: ['items.read'], risk: 'read-only' }, execute: ({ id }) => Promise.resolve({ id }) }));
    app = createServer({
      runtime: createRuntime({ executor: createEchoExecutor() }),
      modelRuntime: createModelRuntime({ providers: [provider()] }), toolRegistry, telemetry,
      actionFirewall: createActionFirewall(),
      authenticationAdapter: createStaticAuthenticationAdapter({ viewer: { subject: 'viewer', roles: [], permissions: [], attributes: { tenantId: 'tenant-1' } } }),
    });
    const response = await app.inject({ method: 'POST', url: '/runs', payload, headers: { authorization: 'Bearer viewer' } });
    expect(response.statusCode).toBe(200);
    const decision = telemetry.session().events.find((event) => event.type === 'security.decision');
    expect(decision).toMatchObject({ decision: 'deny', reasonCode: 'PERMISSION_DENIED' });
    expect(decision?.correlation.runId).toBeDefined();
  });
});
