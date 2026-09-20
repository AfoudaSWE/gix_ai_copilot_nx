import { describe, expect, it } from 'vitest';
import { createKnowledgeDocument, deriveDocumentId, hashContent } from './document.js';

describe('hashContent', () => {
  it('is deterministic for identical content', () => {
    expect(hashContent('hello world')).toBe(hashContent('hello world'));
  });

  it('differs for different content', () => {
    expect(hashContent('hello world')).not.toBe(hashContent('hello there'));
  });
});

describe('deriveDocumentId', () => {
  it('is deterministic for the same source and discriminator', () => {
    expect(deriveDocumentId('source-1', 3)).toBe(deriveDocumentId('source-1', 3));
  });

  it('differs across discriminators of the same source', () => {
    expect(deriveDocumentId('source-1', 1)).not.toBe(deriveDocumentId('source-1', 2));
  });

  it('differs across sources with the same discriminator', () => {
    expect(deriveDocumentId('source-1', 1)).not.toBe(deriveDocumentId('source-2', 1));
  });

  it('is stable with no discriminator', () => {
    expect(deriveDocumentId('source-1')).toBe(deriveDocumentId('source-1'));
  });
});

describe('createKnowledgeDocument', () => {
  it('populates a deterministic id and contentHash', () => {
    const doc = createKnowledgeDocument({ sourceId: 'source-1', content: 'hello' });
    expect(doc.id).toBe(deriveDocumentId('source-1'));
    expect(doc.metadata.contentHash).toBe(hashContent('hello'));
    expect(doc.sourceId).toBe('source-1');
    expect(doc.content).toBe('hello');
  });

  it('re-hashes when content changes, enabling change detection (Section 132/133)', () => {
    const before = createKnowledgeDocument({ sourceId: 'source-1', content: 'v1' });
    const after = createKnowledgeDocument({ sourceId: 'source-1', content: 'v2' });
    expect(before.id).toBe(after.id); // same position in the source
    expect(before.metadata.contentHash).not.toBe(after.metadata.contentHash); // but content changed
  });

  it('preserves caller-supplied metadata alongside the computed contentHash', () => {
    const doc = createKnowledgeDocument({
      sourceId: 'source-1',
      content: 'hello',
      metadata: { title: 'Doc', tenantId: 'tenant-a' },
    });
    expect(doc.metadata.title).toBe('Doc');
    expect(doc.metadata.tenantId).toBe('tenant-a');
  });
});
