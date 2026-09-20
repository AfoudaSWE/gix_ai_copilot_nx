import { describe, expect, it } from 'vitest';
import { assignCitationIds, validateCitations } from './citations.js';
import type { RetrievalItem } from './retriever.js';

function item(documentId: string, content: string, extra: Partial<RetrievalItem['chunk']['metadata']> = {}): RetrievalItem {
  return {
    chunk: {
      id: `${documentId}-chunk`,
      documentId,
      sourceId: 'source-1',
      content,
      metadata: { documentId, sourceId: 'source-1', position: 0, contentHash: 'x', ...extra },
    },
    score: 0.9,
    provenance: { sourceId: 'source-1', documentId },
  };
}

describe('assignCitationIds', () => {
  it('assigns stable, rank-ordered ids starting at S1', () => {
    const { items, citations } = assignCitationIds([item('doc-1', 'first'), item('doc-2', 'second')]);
    expect(items.map((i) => i.citationId)).toEqual(['S1', 'S2']);
    expect(citations.map((c) => c.id)).toEqual(['S1', 'S2']);
  });

  it('maps each citation back to its source/document/page/section (Section 70)', () => {
    const { citations } = assignCitationIds([
      item('doc-1', 'content', { title: 'Handbook', page: 17, section: 'Annual Leave' }),
    ]);
    expect(citations[0]).toMatchObject({
      id: 'S1',
      sourceId: 'source-1',
      documentId: 'doc-1',
      title: 'Handbook',
      page: 17,
      section: 'Annual Leave',
    });
  });

  it('truncates a long excerpt rather than including the full chunk verbatim', () => {
    const longContent = 'x'.repeat(500);
    const { citations } = assignCitationIds([item('doc-1', longContent)]);
    expect(citations[0]?.excerpt?.length).toBeLessThan(longContent.length);
  });

  it('produces no citations for an empty item list', () => {
    const { items, citations } = assignCitationIds([]);
    expect(items).toEqual([]);
    expect(citations).toEqual([]);
  });
});

describe('validateCitations', () => {
  it('accepts citations that only reference known ids', () => {
    const { citations } = assignCitationIds([item('doc-1', 'a'), item('doc-2', 'b')]);
    const result = validateCitations('Employees get 25 days. [S1] Carry-over is 5 days. [S2]', citations);
    expect(result.valid).toBe(true);
    expect([...result.citedIds].sort()).toEqual(['S1', 'S2']);
    expect(result.unknownIds).toEqual([]);
  });

  it('detects an unknown citation id the model invented (Section 74)', () => {
    const { citations } = assignCitationIds([item('doc-1', 'a')]);
    const result = validateCitations('According to [S1] and also [S9].', citations);
    expect(result.valid).toBe(false);
    expect(result.unknownIds).toEqual(['S9']);
  });

  it('is valid (vacuously) when the model text cites nothing', () => {
    const { citations } = assignCitationIds([item('doc-1', 'a')]);
    const result = validateCitations('No citations here.', citations);
    expect(result.valid).toBe(true);
    expect(result.citedIds).toEqual([]);
  });
});
