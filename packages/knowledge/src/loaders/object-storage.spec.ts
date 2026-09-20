import { describe, expect, it } from 'vitest';
import { CopilotError } from '@gixcopilot/protocol';
import { objectStorageSource, type ObjectStorageClient } from '../source.js';
import { objectStorageLoader } from './object-storage.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

function createFakeClient(objects: Record<string, string>): ObjectStorageClient {
  return {
    list: (prefix) => Promise.resolve(Object.keys(objects).filter((k) => !prefix || k.startsWith(prefix))),
    get: (key) => {
      const content = objects[key];
      if (content === undefined) throw new Error(`not found: ${key}`);
      return Promise.resolve({ key, content });
    },
  };
}

describe('objectStorageLoader', () => {
  it('lists and reads every object when no explicit key list is given', async () => {
    const client = createFakeClient({ 'docs/a.txt': 'Content A', 'docs/b.txt': 'Content B' });
    const source = objectStorageSource({ client, tenantId: 'tenant-a' });
    const docs = await collect(objectStorageLoader.load(source));
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.content).sort()).toEqual(['Content A', 'Content B']);
    expect(docs.every((d) => d.metadata.tenantId === 'tenant-a')).toBe(true);
  });

  it('reads only the explicitly given keys', async () => {
    const client = createFakeClient({ 'a.txt': 'A', 'b.txt': 'B' });
    const source = objectStorageSource({ client, keys: ['a.txt'] });
    const docs = await collect(objectStorageLoader.load(source));
    expect(docs).toHaveLength(1);
    expect(docs[0]?.content).toBe('A');
    expect(docs[0]?.metadata.uri).toBe('a.txt');
  });

  it('wraps a failed object read as a normalized error', async () => {
    const client = createFakeClient({});
    const source = objectStorageSource({ client, keys: ['missing.txt'] });
    await expect(collect(objectStorageLoader.load(source))).rejects.toThrow(CopilotError);
  });
});
