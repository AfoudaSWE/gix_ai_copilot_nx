import { createHash } from 'node:crypto';
import type { KnowledgeACL } from '@gixcopilot/knowledge';

/**
 * Provenance/authorization metadata a chunk inherits from its document (Section 28) - kept to
 * the specific fields retrieval/citation/authorization actually need, not a full copy of every
 * document metadata field, per Section 28's "do not duplicate giant metadata objects."
 */
export interface ChunkMetadata {
  readonly documentId: string;
  readonly sourceId: string;
  readonly title?: string;
  readonly uri?: string;
  readonly page?: number;
  readonly section?: string;
  readonly heading?: string;
  /** 0-based position of this chunk within its document. */
  readonly position: number;
  readonly tenantId?: string;
  readonly acl?: KnowledgeACL;
  readonly tags?: readonly string[];
  readonly contentHash: string;
}

/** Retrieval unit produced by a Chunker (Section 27). */
export interface KnowledgeChunk {
  readonly id: string;
  readonly documentId: string;
  readonly sourceId: string;
  readonly content: string;
  readonly metadata: ChunkMetadata;
}

/**
 * Deterministic chunk identity (Section 29): stable across re-chunking of unchanged content
 * (document identity + position + content), so reindexing an unchanged document produces the
 * exact same chunk ids and an actually-changed chunk gets a new id - enabling clean diffing on
 * reindex instead of ambiguous "did this change?" comparisons.
 */
export function deriveChunkId(documentId: string, position: number, content: string): string {
  return createHash('sha256').update(`${documentId}::${position}::${content}`, 'utf8').digest('hex').slice(0, 32);
}

export function hashChunkContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
