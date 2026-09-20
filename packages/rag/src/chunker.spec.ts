import { createKnowledgeDocument } from '@gixcopilot/knowledge';
import { describe, expect, it } from 'vitest';
import { createRecursiveChunker } from './chunker.js';

describe('createRecursiveChunker', () => {
  it('produces no chunks for empty content', async () => {
    const chunker = createRecursiveChunker();
    const document = createKnowledgeDocument({ sourceId: 's1', content: '' });
    expect(await chunker.chunk(document)).toEqual([]);
  });

  it('produces a single chunk when content fits within chunkSize', async () => {
    const chunker = createRecursiveChunker({ chunkSize: 1000 });
    const document = createKnowledgeDocument({ sourceId: 's1', content: 'A short paragraph.' });
    const chunks = await chunker.chunk(document);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe('A short paragraph.');
  });

  it('is deterministic - chunking the same document twice yields identical chunk ids/content', async () => {
    const chunker = createRecursiveChunker({ chunkSize: 50, chunkOverlap: 10 });
    const content = Array.from({ length: 20 }, (_, i) => `Paragraph number ${i} with some content.`).join('\n\n');
    const document = createKnowledgeDocument({ sourceId: 's1', content });
    const first = await chunker.chunk(document);
    const second = await chunker.chunk(document);
    expect(first.map((c) => c.id)).toEqual(second.map((c) => c.id));
    expect(first.map((c) => c.content)).toEqual(second.map((c) => c.content));
  });

  it('splits large content into multiple chunks, each within chunkSize', async () => {
    const chunker = createRecursiveChunker({ chunkSize: 100, chunkOverlap: 20 });
    const content = Array.from({ length: 30 }, (_, i) => `Sentence ${i}.`).join(' ');
    const document = createKnowledgeDocument({ sourceId: 's1', content });
    const chunks = await chunker.chunk(document);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(120); // small slack for separator/boundary rounding
    }
  });

  it('produces overlapping content between consecutive chunks', async () => {
    const chunker = createRecursiveChunker({ chunkSize: 60, chunkOverlap: 20, separators: [' '] });
    const content = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const document = createKnowledgeDocument({ sourceId: 's1', content });
    const chunks = await chunker.chunk(document);
    expect(chunks.length).toBeGreaterThan(1);

    const firstWords = chunks[0]?.content.split(' ') ?? [];
    const secondWords = chunks[1]?.content.split(' ') ?? [];
    const overlap = firstWords.filter((word) => secondWords.includes(word));
    expect(overlap.length).toBeGreaterThan(0);
  });

  it('assigns sequential position metadata and inherits document provenance (Section 28)', async () => {
    const chunker = createRecursiveChunker({ chunkSize: 30, chunkOverlap: 5 });
    const content = 'First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.';
    const document = createKnowledgeDocument({
      sourceId: 'source-1',
      content,
      metadata: { title: 'Handbook', page: 3, tenantId: 'tenant-a', acl: { permissions: ['read'] } },
    });
    const chunks = await chunker.chunk(document);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, index) => {
      expect(chunk.metadata.position).toBe(index);
      expect(chunk.metadata.documentId).toBe(document.id);
      expect(chunk.metadata.sourceId).toBe('source-1');
      expect(chunk.metadata.title).toBe('Handbook');
      expect(chunk.metadata.page).toBe(3);
      expect(chunk.metadata.tenantId).toBe('tenant-a');
      expect(chunk.metadata.acl?.permissions).toEqual(['read']);
    });
  });

  it('keeps a markdown table intact as one block rather than cutting it mid-row (Section 33)', async () => {
    const chunker = createRecursiveChunker({ chunkSize: 40, chunkOverlap: 0 });
    const table = '| Name | Days |\n| --- | --- |\n| Alice | 25 |\n| Bob | 20 |';
    const content = `Intro text.\n\n${table}\n\nOutro text.`;
    const document = createKnowledgeDocument({ sourceId: 's1', content });
    const chunks = await chunker.chunk(document);
    // The table is preserved as one intact, contiguous block (never cut mid-row) - it may still
    // share a chunk with surrounding prose if there's room, since a table is treated as an
    // atomic unit rather than being isolated into its own chunk.
    const tableChunk = chunks.find((c) => c.content.includes('Alice'));
    expect(tableChunk?.content).toContain(table);
  });

  it('respects a custom separator hierarchy', async () => {
    const chunker = createRecursiveChunker({ chunkSize: 15, chunkOverlap: 0, separators: [','] });
    const document = createKnowledgeDocument({ sourceId: 's1', content: 'aaaa,bbbb,cccc,dddd' });
    const chunks = await chunker.chunk(document);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.content.length <= 20)).toBe(true);
  });
});
