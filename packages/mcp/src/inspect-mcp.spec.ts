import { describe, expect, it } from 'vitest';
import { inspectMCP } from './inspect-mcp.js';
import { connectedTestClient } from './test-server.js';

describe('inspectMCP', () => {
  it('returns generated tools and a report without needing a registry', async () => {
    const { client, dispose } = await connectedTestClient();
    const result = await inspectMCP({ client, defaultExposure: 'allow' });
    expect(result.tools.map((tool) => tool.name).sort()).toEqual([
      'mcp.testServer.add',
      'mcp.testServer.echo',
      'mcp.testServer.fails',
    ]);
    expect(result.report.generated).toBe(3);
    await dispose();
  });
});
