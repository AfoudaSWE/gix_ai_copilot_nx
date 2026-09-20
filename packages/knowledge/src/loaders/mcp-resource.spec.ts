import { describe, expect, it } from 'vitest';
import { CopilotError } from '@gixcopilot/protocol';
import { mcpResourceSource, type McpResourceReader } from '../source.js';
import { mcpResourceLoader } from './mcp-resource.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

function createFakeMcpClient(resources: Record<string, { text?: string; mimeType?: string }>): McpResourceReader {
  return {
    listResources: () =>
      Promise.resolve(Object.keys(resources).map((uri) => ({ uri, name: uri }))),
    readResource: (uri) => {
      const resource = resources[uri];
      if (!resource) throw new Error(`unknown resource: ${uri}`);
      return Promise.resolve({ uri, ...resource });
    },
  };
}

describe('mcpResourceLoader', () => {
  it('ingests every advertised resource when no explicit uris are given', async () => {
    const client = createFakeMcpClient({
      'res://a': { text: 'Resource A text' },
      'res://b': { text: 'Resource B text' },
    });
    const source = mcpResourceSource({ client, tenantId: 'tenant-a' });
    const docs = await collect(mcpResourceLoader.load(source));
    expect(docs).toHaveLength(2);
    expect(docs.every((d) => d.metadata.tenantId === 'tenant-a')).toBe(true);
  });

  it('ingests only explicitly listed uris', async () => {
    const client = createFakeMcpClient({ 'res://a': { text: 'A' }, 'res://b': { text: 'B' } });
    const source = mcpResourceSource({ client, uris: ['res://a'] });
    const docs = await collect(mcpResourceLoader.load(source));
    expect(docs).toHaveLength(1);
    expect(docs[0]?.content).toBe('A');
    expect(docs[0]?.metadata.uri).toBe('res://a');
  });

  it('skips binary resources (no text field) rather than failing (documented limitation)', async () => {
    const client = createFakeMcpClient({ 'res://binary': { mimeType: 'image/png' } });
    const source = mcpResourceSource({ client, uris: ['res://binary'] });
    const docs = await collect(mcpResourceLoader.load(source));
    expect(docs).toHaveLength(0);
  });

  it('wraps a failed resource read as a normalized error', async () => {
    const client = createFakeMcpClient({});
    const source = mcpResourceSource({ client, uris: ['res://missing'] });
    await expect(collect(mcpResourceLoader.load(source))).rejects.toThrow(CopilotError);
  });
});
