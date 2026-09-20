import { describe, expect, it } from 'vitest';
import { createMcpClient } from './client.js';
import { connectedTestClient } from './test-server.js';
import type { McpConnectionState } from './types.js';

describe('createMcpClient (via InMemoryTransport)', () => {
  it('transitions connecting -> connected on connect()', async () => {
    const states: McpConnectionState[] = [];
    const { client, dispose } = await connectedTestClient((state) => states.push(state));
    expect(client.state).toBe('connected');
    expect(states).toEqual(['connecting', 'connected']);
    await dispose();
  });

  it('transitions closing -> disconnected on disconnect()', async () => {
    const states: McpConnectionState[] = [];
    const { client, dispose } = await connectedTestClient((state) => states.push(state));
    states.length = 0;
    await dispose();
    expect(client.state).toBe('disconnected');
    expect(states).toEqual(['closing', 'disconnected']);
  });

  it('discovers tools and preserves name/description/input schema', async () => {
    const { client, dispose } = await connectedTestClient();
    const tools = await client.listTools();
    const echo = tools.find((tool) => tool.name === 'echo');
    expect(echo).toBeDefined();
    expect(echo?.description).toBe('Echoes the given message back.');
    expect(echo?.inputSchema).toMatchObject({ type: 'object' });
    await dispose();
  });

  it('calls a tool and returns normalized text content', async () => {
    const { client, dispose } = await connectedTestClient();
    const result = await client.callTool('echo', { message: 'hi' });
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: 'text', text: 'hi' }]);
    await dispose();
  });

  it('preserves structuredContent when the tool provides it', async () => {
    const { client, dispose } = await connectedTestClient();
    const result = await client.callTool('add', { a: 2, b: 3 });
    expect(result.structuredContent).toEqual({ sum: 5 });
    await dispose();
  });

  it('surfaces isError: true from a failing tool without throwing', async () => {
    const { client, dispose } = await connectedTestClient();
    const result = await client.callTool('fails', {});
    expect(result.isError).toBe(true);
    await dispose();
  });

  it('lists and reads resources', async () => {
    const { client, dispose } = await connectedTestClient();
    const resources = await client.listResources();
    expect(resources).toEqual([
      { uri: 'test://widgets/1', name: 'widget', description: 'A test resource.', mimeType: 'text/plain' },
    ]);
    const content = await client.readResource('test://widgets/1');
    expect(content).toEqual({ uri: 'test://widgets/1', mimeType: 'text/plain', text: 'widget contents' });
    await dispose();
  });

  it('lists prompts', async () => {
    const { client, dispose } = await connectedTestClient();
    const prompts = await client.listPrompts();
    expect(prompts).toEqual([{ name: 'greet', description: 'Greets someone.' }]);
    await dispose();
  });

  it('throws a clear error when calling a discovery method before connecting', async () => {
    const client = createMcpClient({ serverId: 'never-connected', transport: { kind: 'stdio', command: 'noop' } });
    await expect(client.listTools()).rejects.toThrow('is not connected');
  });
});


describe('MCP lifecycle failures', () => {
  it('marks remote closure disconnected and rejects subsequent requests', async () => {
    const { client, server } = await connectedTestClient();
    await server.close();
    expect(client.state).toBe('disconnected');
    await expect(client.listTools()).rejects.toThrow('not connected');
    await client.disconnect();
  });
  it('honors a call cancellation before dispatch', async () => {
    const { client, dispose } = await connectedTestClient();
    const controller = new AbortController(); controller.abort();
    try { await expect(client.callTool('echo', { message: 'hello' }, { signal: controller.signal })).rejects.toThrow(); }
    finally { await dispose(); }
  });
});


it('cleans up a stdio child that never completes the handshake before timeout', async () => {
  const client = createMcpClient({ serverId: 'silent', timeoutMs: 50, transport: { kind: 'stdio', command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] } });
  await expect(client.connect()).rejects.toThrow();
  expect(client.state).toBe('error');
  await client.disconnect();
  expect(client.state).toBe('disconnected');
});

it('enforces MCP tool deadlines over the SDK transport', async () => {
  const { client, server, dispose } = await connectedTestClient();
  server.registerTool('slow', {}, async () => { await new Promise((resolve) => setTimeout(resolve, 80)); return { content: [{ type: 'text', text: 'late' }] }; });
  try { await expect(client.callTool('slow', {}, { timeoutMs: 10 })).rejects.toMatchObject({ code: -32001 }); }
  finally { await dispose(); }
});
