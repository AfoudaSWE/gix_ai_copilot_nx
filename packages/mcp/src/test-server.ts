import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createMcpClientFromTransportFactory } from './client.js';
import type { McpClient } from './client.js';
import type { McpConnectionState } from './types.js';

/**
 * Spins up a real (in-process) MCP server with a small, fixed tool/resource/prompt set - used
 * only by this package's own tests, so `client.ts`/`tool-generator.ts` are verified against
 * the real SDK's wire behavior over `InMemoryTransport` rather than a hand-rolled mock of it.
 */
export function createTestMcpServer(): McpServer {
  const server = new McpServer({ name: 'test-server', version: '1.0.0' });

  server.registerTool(
    'echo',
    { description: 'Echoes the given message back.', inputSchema: { message: z.string() } },
    ({ message }) => ({ content: [{ type: 'text', text: message }] }),
  );

  server.registerTool(
    'add',
    { description: 'Adds two numbers.', inputSchema: { a: z.number(), b: z.number() } },
    ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }], structuredContent: { sum: a + b } }),
  );

  server.registerTool('fails', { description: 'Always fails.' }, () => ({
    content: [{ type: 'text', text: 'boom' }],
    isError: true,
  }));

  server.registerResource(
    'widget',
    'test://widgets/1',
    { title: 'Widget 1', description: 'A test resource.', mimeType: 'text/plain' },
    (uri) => ({ contents: [{ uri: uri.toString(), text: 'widget contents', mimeType: 'text/plain' }] }),
  );

  server.registerPrompt(
    'greet',
    { description: 'Greets someone.', argsSchema: { name: z.string() } },
    ({ name }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Hello, ${name}!` } }] }),
  );

  return server;
}

/** A connected client/server pair over `InMemoryTransport`, plus a `dispose()` that closes
 * both sides - the standard fixture every MCP package test built against a real server uses. */
export async function connectedTestClient(
  onStateChange?: (state: McpConnectionState) => void,
): Promise<{ readonly client: McpClient; readonly server: McpServer; readonly dispose: () => Promise<void> }> {
  const server = createTestMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = createMcpClientFromTransportFactory('test-server', () => clientTransport, onStateChange);
  await client.connect();

  return { client, server, dispose: () => client.disconnect() };
}
