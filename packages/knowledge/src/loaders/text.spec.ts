import { describe, expect, it } from 'vitest';
import { textSource } from '../source.js';
import { textLoader } from './text.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe('textLoader', () => {
  it('produces one normalized document per text source', async () => {
    const source = textSource({ name: 'Notes', content: 'line one\r\nline two' });
    const docs = await collect(textLoader.load(source));
    expect(docs).toHaveLength(1);
    expect(docs[0]?.content).toBe('line one\nline two');
    expect(docs[0]?.metadata.title).toBe('Notes');
    expect(docs[0]?.metadata.mimeType).toBe('text/plain');
    expect(docs[0]?.sourceId).toBe(source.id);
  });

  it('carries tenantId/acl through to document metadata', async () => {
    const source = textSource({ content: 'x', tenantId: 'tenant-a', permissions: ['read'] });
    const [doc] = await collect(textLoader.load(source));
    expect(doc?.metadata.tenantId).toBe('tenant-a');
    expect(doc?.metadata.acl?.permissions).toEqual(['read']);
  });

  it('respects an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const source = textSource({ content: 'x' });
    await expect(collect(textLoader.load(source, { signal: controller.signal }))).rejects.toThrow();
  });
});
