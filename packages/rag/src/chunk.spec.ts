import { describe, expect, it } from 'vitest';
import { deriveChunkId, hashChunkContent } from './chunk.js';

describe('deriveChunkId', () => {
  it('is deterministic for the same document, position, and content', () => {
    expect(deriveChunkId('doc-1', 0, 'hello')).toBe(deriveChunkId('doc-1', 0, 'hello'));
  });

  it('changes when content changes at the same position (enables reindex diffing)', () => {
    expect(deriveChunkId('doc-1', 0, 'v1')).not.toBe(deriveChunkId('doc-1', 0, 'v2'));
  });

  it('changes across positions within the same document', () => {
    expect(deriveChunkId('doc-1', 0, 'hello')).not.toBe(deriveChunkId('doc-1', 1, 'hello'));
  });

  it('changes across documents', () => {
    expect(deriveChunkId('doc-1', 0, 'hello')).not.toBe(deriveChunkId('doc-2', 0, 'hello'));
  });
});

describe('hashChunkContent', () => {
  it('is deterministic', () => {
    expect(hashChunkContent('hello')).toBe(hashChunkContent('hello'));
  });
});
