import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CopilotError } from '@gixcopilot/protocol';
import { createStaticToolResolver, createToolRuntime, defineTool } from '@gixcopilot/tools';
import type { AnyToolDefinition, ToolRuntimeMiddleware } from '@gixcopilot/tools';
import { createMcpToolServer } from './index.js';
import type { McpToolServer } from './index.js';

const orders = new Map<string, string>([['O-1', 'shipped']]);

const tools: AnyToolDefinition[] = [
  defineTool({
    name: 'orders.get',
    description: 'Get an order status',
    input: z.object({ id: z.string() }),
    security: { risk: 'read-only', requiredPermissions: ['orders.read'] },
    execute: ({ id }, context) => Promise.resolve({ id, status: orders.get(id) ?? 'unknown', caller: context.metadata?.['user'] }),
  }),
  defineTool({
    name: 'orders.cancel',
    description: 'Cancel an order',
    input: z.object({ id: z.string() }),
    security: { risk: 'destructive', requiredPermissions: ['orders.write'] },
    execute: ({ id }) => {
      orders.set(id, 'cancelled');
      return Promise.resolve({ id, status: 'cancelled' });
    },
  }),
];

/** Stand-in for the Action Firewall middleware: denies destructive tools, records every call. */
const calls: string[] = [];
const firewall: ToolRuntimeMiddleware = async (invocation, next) => {
  calls.push(invocation.name);
  const tool = tools.find((candidate) => candidate.name === invocation.name);
  if (tool?.security?.risk === 'destructive') return { status: 'error', toolCallId: invocation.toolCallId, error: CopilotError.approvalRequired('admin', 'appr-1').toPublicJSON() };
  return next();
};
const runtime = createToolRuntime({ resolver: createStaticToolResolver(tools), middleware: [firewall] });

let server: McpToolServer | undefined;
let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  await server?.close();
});

async function connect(user?: string): Promise<Client> {
  server = createMcpToolServer({ name: 'orders', version: '1.2.3', instructions: 'Order tools.', tools, runtime });
  const mcp = server;
  const transport = new StreamableHTTPClientTransport(new URL('http://mcp.test/mcp'), {
    fetch: (input, init) => mcp.handleRequest(new Request(input, init), { metadata: { user } }),
  });
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

describe('createMcpToolServer', () => {
  it('lists tools with JSON Schema input and risk annotations', async () => {
    const mcp = await connect();
    expect(mcp.getServerVersion()).toMatchObject({ name: 'orders', version: '1.2.3' });
    expect(mcp.getInstructions()).toBe('Order tools.');
    const { tools: listed } = await mcp.listTools();
    expect(listed.map((tool) => tool.name)).toEqual(['orders.get', 'orders.cancel']);
    expect(listed[0]?.inputSchema).toMatchObject({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] });
    expect(listed[0]?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(listed[1]?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  it('executes calls through the runtime middleware, with caller metadata and structured output', async () => {
    const mcp = await connect('alice');
    calls.length = 0;
    const result = await mcp.callTool({ name: 'orders.get', arguments: { id: 'O-1' } });
    expect(calls).toEqual(['orders.get']);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ id: 'O-1', status: 'shipped', caller: 'alice' });
  });

  it('returns firewall decisions and validation failures as MCP tool errors, and never runs denied tools', async () => {
    const mcp = await connect();
    const denied = await mcp.callTool({ name: 'orders.cancel', arguments: { id: 'O-1' } });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied.content)).toContain('APPROVAL_REQUIRED');
    expect(orders.get('O-1')).toBe('shipped');
    const invalid = await mcp.callTool({ name: 'orders.get', arguments: { id: 42 } });
    expect(invalid.isError).toBe(true);
    const unknown = await mcp.callTool({ name: 'orders.delete', arguments: {} });
    expect(JSON.stringify(unknown.content)).toContain('TOOL_NOT_FOUND');
  });

  it('only exposes the tools it lists, even if the runtime knows more', async () => {
    server = createMcpToolServer({ name: 'readonly', tools: () => tools.filter((tool) => tool.security?.risk === 'read-only'), runtime });
    const mcp = server;
    client = new Client({ name: 'c', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL('http://mcp.test/mcp'), { fetch: (input, init) => mcp.handleRequest(new Request(input, init)) }));
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['orders.get']);
    const hidden = await client.callTool({ name: 'orders.cancel', arguments: { id: 'O-1' } });
    expect(JSON.stringify(hidden.content)).toContain('TOOL_NOT_FOUND');
  });

  it('requires a name and a runtime', () => {
    expect(() => createMcpToolServer({ name: ' ', tools, runtime })).toThrow(/name/);
    expect(() => createMcpToolServer({ name: 'x', tools } as unknown as Parameters<typeof createMcpToolServer>[0])).toThrow(/runtime/);
  });
});
