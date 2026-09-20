import { describe, expect, it } from 'vitest';
import { CopilotError } from '@gixcopilot/protocol';
import { createDatabaseKnowledgeSource } from '../source.js';
import { createDatabaseLoader, databaseLoader as defaultDatabaseLoader } from './database.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

interface Row {
  id: string;
  body: string;
}

const databaseLoader = createDatabaseLoader<Row>();

describe('databaseLoader', () => {
  it('maps caller-supplied rows into documents without ever building SQL itself (Section 22)', async () => {
    const rows: Row[] = [
      { id: 'POL-1', body: 'Row one text' },
      { id: 'POL-2', body: 'Row two text' },
    ];
    const source = createDatabaseKnowledgeSource<Row>({
      tenantId: 'tenant-a',
      query: () => Promise.resolve(rows),
      toDocument: (row) => ({ content: row.body, discriminator: row.id, metadata: { title: row.id } }),
    });

    const docs = await collect(databaseLoader.load(source));
    expect(docs).toHaveLength(2);
    expect(docs[0]?.content).toBe('Row one text');
    expect(docs[0]?.metadata.title).toBe('POL-1');
    expect(docs[0]?.metadata.tenantId).toBe('tenant-a');
  });

  it('produces stable ids per row across re-ingestion', async () => {
    const source = createDatabaseKnowledgeSource<Row>({
      id: 'db-source',
      query: () => Promise.resolve([{ id: 'r1', body: 'x' }]),
      toDocument: (row) => ({ content: row.body, discriminator: row.id }),
    });
    const first = await collect(databaseLoader.load(source));
    const second = await collect(databaseLoader.load(source));
    expect(first[0]?.id).toBe(second[0]?.id);
  });

  it('wraps a query failure as a normalized error', async () => {
    const source = createDatabaseKnowledgeSource<Row>({
      query: () => {
        throw new Error('db down');
      },
      toDocument: (row) => ({ content: row.body }),
    });
    await expect(collect(databaseLoader.load(source))).rejects.toThrow(CopilotError);
  });

  it('the default-typed export works for callers not using a custom row type', async () => {
    const source = createDatabaseKnowledgeSource<unknown>({
      query: () => Promise.resolve([{ text: 'untyped row' }]),
      toDocument: (row) => ({ content: (row as { text: string }).text }),
    });
    const docs = await collect(defaultDatabaseLoader.load(source));
    expect(docs[0]?.content).toBe('untyped row');
  });
});
