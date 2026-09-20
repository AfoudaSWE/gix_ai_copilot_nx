import { createHash } from 'node:crypto';
import type { KnowledgeACL } from './acl.js';

/**
 * Descriptive metadata about a KnowledgeDocument (Section 12). Free-form `tags`/business
 * metadata are allowed, but nothing here is implicitly trusted for authorization - only
 * `tenantId`/`acl` participate in the rag package's retrieval-time authorization checks.
 * Arbitrary sensitive metadata reaching the model automatically is avoided by never including
 * this object wholesale in model context - rag's citation/context formatting picks specific
 * fields deliberately (Section 12).
 */
export interface DocumentMetadata {
  readonly title?: string;
  /** Where this document originally came from - a file path, URL, or opaque source-specific id. */
  readonly uri?: string;
  readonly mimeType?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly author?: string;
  /** Mandatory for any document that should be tenant-isolated during retrieval (Section 45/59). */
  readonly tenantId?: string;
  readonly acl?: KnowledgeACL;
  readonly tags?: readonly string[];
  /** 1-based page number, when the source is paginated (PDF, etc.) - Section 14/18. */
  readonly page?: number;
  readonly section?: string;
  readonly heading?: string;
  /**
   * Stable digest of `content`, used for change detection/deduplication/idempotent reindexing
   * (Section 132/133) - always populated by `hashContent`, never left to the caller to compute
   * inconsistently.
   */
  readonly contentHash?: string;
  readonly businessMetadata?: Readonly<Record<string, unknown>>;
}

/** Normalized document representation every loader produces (Section 12). */
export interface KnowledgeDocument {
  readonly id: string;
  readonly sourceId: string;
  readonly content: string;
  readonly metadata: DocumentMetadata;
}

/** SHA-256 digest of `content`, used for both `contentHash` and deterministic id derivation. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Deterministic document id: stable across re-ingestion of the *same* source position (so
 * reindex/update/delete/citation all agree - Section 13), but changes when content changes so
 * a content-hash-based `contentHash` can still detect the change (Section 132). `discriminator`
 * disambiguates multiple documents from one source (e.g. a page number, a row id, a resource
 * URI) - omit only when the source itself is single-document.
 */
export function deriveDocumentId(sourceId: string, discriminator?: string | number): string {
  const key = JSON.stringify([sourceId, discriminator ?? null]);
  return createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 32);
}

export interface CreateKnowledgeDocumentInput {
  readonly sourceId: string;
  readonly content: string;
  readonly discriminator?: string | number;
  readonly metadata?: Omit<DocumentMetadata, 'contentHash'>;
}

/** Builds a KnowledgeDocument with a deterministic id and a populated contentHash. */
export function createKnowledgeDocument(input: CreateKnowledgeDocumentInput): KnowledgeDocument {
  return {
    id: deriveDocumentId(input.sourceId, input.discriminator),
    sourceId: input.sourceId,
    content: input.content,
    metadata: {
      ...input.metadata,
      contentHash: hashContent(input.content),
    },
  };
}
