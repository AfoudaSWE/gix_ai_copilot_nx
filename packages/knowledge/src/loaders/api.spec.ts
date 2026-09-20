import { describe, expect, it } from 'vitest';
import { CopilotError } from '@gixcopilot/protocol';
import { apiSource } from '../source.js';
import { apiLoader } from './api.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe('apiLoader', () => {
  it('turns a caller-mapped response into documents, never performing an action itself', async () => {
    const source = apiSource({
      tenantId: 'tenant-a',
      request: () => Promise.resolve({ policies: [{ id: 'POL-102', text: 'Leave policy text' }] }),
      toDocuments: (response) => {
        const { policies } = response as { policies: { id: string; text: string }[] };
        return policies.map((p) => ({ content: p.text, discriminator: p.id, metadata: { title: p.id } }));
      },
    });

    const docs = await collect(apiLoader.load(source));
    expect(docs).toHaveLength(1);
    expect(docs[0]?.content).toBe('Leave policy text');
    expect(docs[0]?.metadata.title).toBe('POL-102');
    expect(docs[0]?.metadata.tenantId).toBe('tenant-a');
  });

  it('wraps a request failure as a normalized SOURCE_LOAD_FAILED error', async () => {
    const source = apiSource({
      request: () => {
        throw new Error('network down');
      },
      toDocuments: () => [],
    });
    await expect(collect(apiLoader.load(source))).rejects.toThrow(CopilotError);
  });

  it('skips documents that normalize to empty content', async () => {
    const source = apiSource({
      request: () => Promise.resolve({}),
      toDocuments: () => [{ content: '   ' }, { content: 'real' }],
    });
    const docs = await collect(apiLoader.load(source));
    expect(docs).toHaveLength(1);
    expect(docs[0]?.content).toBe('real');
  });
});
