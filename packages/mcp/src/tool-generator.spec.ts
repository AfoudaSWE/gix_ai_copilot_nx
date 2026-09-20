import { describe, expect, it } from 'vitest';
import { createMcpClient } from './client.js';
import { connectedTestClient } from './test-server.js';
import { generateMcpTools } from './tool-generator.js';

describe('generateMcpTools', () => {
  it('denies every tool by default (Section 79 - unknown remote tools get no unrestricted authority)', async () => {
    const { client, dispose } = await connectedTestClient();
    const result = await generateMcpTools({ client });
    expect(result.tools).toEqual([]);
    expect(result.report.denied).toBe(3);
    expect(result.report.generated).toBe(0);
    await dispose();
  });

  it('generates namespaced tools when defaultExposure is raised to allow', async () => {
    const { client, dispose } = await connectedTestClient();
    const result = await generateMcpTools({ client, defaultExposure: 'allow' });
    const names = result.tools.map((tool) => tool.name).sort();
    expect(names).toEqual(['mcp.testServer.add', 'mcp.testServer.echo', 'mcp.testServer.fails']);
    expect(result.report.toolsDiscovered).toBe(3);
    expect(result.report.generated).toBe(3);
    await dispose();
  });

  it('never generates a permission-less tool', async () => {
    const { client, dispose } = await connectedTestClient();
    const result = await generateMcpTools({ client, defaultExposure: 'allow' });
    for (const tool of result.tools) {
      expect(tool.security?.requiredPermissions).toEqual(['mcp.test-server']);
    }
    await dispose();
  });

  it('carries MCP source metadata via ToolMetadata.custom', async () => {
    const { client, dispose } = await connectedTestClient();
    const result = await generateMcpTools({ client, defaultExposure: 'allow', serverTrustLevel: 'internal' });
    const echo = result.tools.find((tool) => tool.name === 'mcp.testServer.echo');
    expect(echo?.metadata?.source).toBe('mcp');
    expect(echo?.metadata?.custom).toEqual({
      sourceType: 'mcp',
      serverId: 'test-server',
      toolName: 'echo',
      serverTrustLevel: 'internal',
    });
    await dispose();
  });

  it('executes a generated tool through the real MCP call path', async () => {
    const { client, dispose } = await connectedTestClient();
    const result = await generateMcpTools({ client, defaultExposure: 'allow' });
    const echo = result.tools.find((tool) => tool.name === 'mcp.testServer.echo');
    const output = await echo?.execute({ message: 'hi' }, { runId: 'run-1', signal: new AbortController().signal });
    expect(output).toEqual({ isError: false, content: [{ type: 'text', text: 'hi' }], structuredContent: undefined });
    await dispose();
  });

  it('throws a normalized error when the tool reports isError: true', async () => {
    const { client, dispose } = await connectedTestClient();
    const result = await generateMcpTools({ client, defaultExposure: 'allow' });
    const fails = result.tools.find((tool) => tool.name === 'mcp.testServer.fails');
    await expect(
      fails?.execute({}, { runId: 'run-1', signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'TOOL_EXECUTION_ERROR' });
    await dispose();
  });

  it('applies transformResult to a successful call', async () => {
    const { client, dispose } = await connectedTestClient();
    const result = await generateMcpTools({
      client,
      defaultExposure: 'allow',
      transformResult: (r) => (r.structuredContent as { sum: number } | undefined)?.sum,
    });
    const add = result.tools.find((tool) => tool.name === 'mcp.testServer.add');
    const output = await add?.execute({ a: 2, b: 3 }, { runId: 'run-1', signal: new AbortController().signal });
    expect(output).toBe(5);
    await dispose();
  });

  it('respects a per-tool override that opts a single tool in without raising the server default', async () => {
    const { client, dispose } = await connectedTestClient();
    const result = await generateMcpTools({ client, tools: { echo: { approval: 'none', permission: 'test.echo' } } });
    const names = result.tools.map((tool) => tool.name);
    expect(names).toEqual(['mcp.testServer.echo']);
    expect(result.report.denied).toBe(2);
    await dispose();
  });

  it('reports a connectionIssue and zero tools when the client cannot connect', async () => {
    const client = createMcpClient({
      serverId: 'unreachable',
      transport: { kind: 'stdio', command: 'this-command-does-not-exist-xyz' },
    });
    const result = await generateMcpTools({ client, defaultExposure: 'allow' });
    expect(result.tools).toEqual([]);
    expect(result.report.connectionIssue).toBeDefined();
    expect(result.report.generated).toBe(0);
  });
});
