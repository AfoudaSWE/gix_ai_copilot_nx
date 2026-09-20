import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import { createToolRegistry } from '@gixcopilot/tools';
import { z } from 'zod';
import { createMcpClientFromTransportFactory } from './client.js';
import { registerMCP } from './register-mcp.js';

async function setup() {
  const server = new McpServer({ name: 'dynamic-server', version: '1.0.0' });
  const widgets = server.registerTool(
    'widgets',
    { description: 'Lists widgets.', inputSchema: { limit: z.number().optional() } },
    () => ({ content: [{ type: 'text', text: 'widgets' }] }),
  );
  server.registerTool('gadgets', { description: 'Lists gadgets.' }, () => ({
    content: [{ type: 'text', text: 'gadgets' }],
  }));

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = createMcpClientFromTransportFactory('dynamic-server', () => clientTransport);

  const registry = createToolRegistry();
  return { server, widgets, client, registry };
}

describe('registerMCP', () => {
  it('registers every generated tool into the given registry', async () => {
    const { client, registry } = await setup();
    const integration = await registerMCP({
      serverId: 'dynamic-server',
      transport: { kind: 'stdio', command: 'unused' },
      client,
      registry,
      defaultExposure: 'allow',
    });
    expect([...integration.toolNames].sort()).toEqual(['mcp.dynamicServer.gadgets', 'mcp.dynamicServer.widgets']);
    expect(registry.has('mcp.dynamicServer.widgets')).toBe(true);
    await integration.dispose();
  });

  it('records a conflict, without overwriting, when a name is already registered by something else', async () => {
    const { client, registry } = await setup();
    registry.register({
      name: 'mcp.dynamicServer.widgets',
      description: 'hand-written',
      inputSchema: { parse: (v: unknown) => v } as never,
      execute: () => Promise.resolve('hand-written-result'),
    });

    const integration = await registerMCP({
      serverId: 'dynamic-server',
      transport: { kind: 'stdio', command: 'unused' },
      client,
      registry,
      defaultExposure: 'allow',
    });

    expect(integration.toolNames).toEqual(['mcp.dynamicServer.gadgets']);
    expect(integration.report.conflicts).toHaveLength(1);
    expect(integration.report.conflicts[0]?.name).toBe('mcp.dynamicServer.widgets');
    expect(registry.get('mcp.dynamicServer.widgets')?.description).toBe('hand-written');
    await integration.dispose();
  });

  it('unregisters a tool whose operation disappeared on refresh', async () => {
    const { client, registry, widgets } = await setup();
    const integration = await registerMCP({
      serverId: 'dynamic-server',
      transport: { kind: 'stdio', command: 'unused' },
      client,
      registry,
      defaultExposure: 'allow',
    });
    expect(registry.has('mcp.dynamicServer.widgets')).toBe(true);

    widgets.remove();
    const refreshedReport = await integration.refresh();

    expect(registry.has('mcp.dynamicServer.widgets')).toBe(false);
    expect(registry.has('mcp.dynamicServer.gadgets')).toBe(true);
    expect(refreshedReport.generated).toBe(1);
    await integration.dispose();
  });

  it('registers a newly-appeared tool on refresh', async () => {
    const { server, client, registry } = await setup();
    const integration = await registerMCP({
      serverId: 'dynamic-server',
      transport: { kind: 'stdio', command: 'unused' },
      client,
      registry,
      defaultExposure: 'allow',
    });

    server.registerTool('sprockets', { description: 'Lists sprockets.' }, () => ({
      content: [{ type: 'text', text: 'sprockets' }],
    }));
    await integration.refresh();

    expect(registry.has('mcp.dynamicServer.sprockets')).toBe(true);
    await integration.dispose();
  });

  it('dispose() unregisters every tool and disconnects the client', async () => {
    const { client, registry } = await setup();
    const integration = await registerMCP({
      serverId: 'dynamic-server',
      transport: { kind: 'stdio', command: 'unused' },
      client,
      registry,
      defaultExposure: 'allow',
    });
    await integration.dispose();
    expect(registry.has('mcp.dynamicServer.widgets')).toBe(false);
    expect(registry.has('mcp.dynamicServer.gadgets')).toBe(false);
    expect(client.state).toBe('disconnected');
  });

  it('exposes resources and prompts as plain pass-through data', async () => {
    const { client, registry } = await setup();
    const integration = await registerMCP({
      serverId: 'dynamic-server',
      transport: { kind: 'stdio', command: 'unused' },
      client,
      registry,
    });
    expect(await integration.listResources()).toEqual([]);
    expect(await integration.listPrompts()).toEqual([]);
    await integration.dispose();
  });
});


it('removes stale tools immediately on remote disconnect and cannot refresh after disposal', async () => {
  const { client, registry, server } = await setup();
  const integration = await registerMCP({ serverId: 'dynamic-server', transport: { kind: 'stdio', command: 'unused' }, client, registry, defaultExposure: 'allow' });
  await server.close();
  expect(registry.list()).toHaveLength(0);
  expect(integration.toolNames).toHaveLength(0);
  await integration.dispose();
  await expect(integration.refresh()).rejects.toThrow('disposed');
});
