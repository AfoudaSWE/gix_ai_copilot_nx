import type { RetrievalItem } from './retriever.js';

/** Enough structured provenance to cite a retrieved chunk's origin (Section 70). */
export interface Citation {
  readonly id: string;
  readonly sourceId: string;
  readonly documentId: string;
  readonly title?: string;
  readonly uri?: string;
  readonly page?: number;
  readonly section?: string;
  readonly excerpt?: string;
}

const EXCERPT_LENGTH = 240;

function excerptOf(content: string): string {
  return content.length > EXCERPT_LENGTH ? `${content.slice(0, EXCERPT_LENGTH)}…` : content;
}

export interface WithCitation {
  readonly item: RetrievalItem;
  readonly citationId: string;
}

/**
 * Assigns stable, rank-ordered citation ids ([S1], [S2], ... - Section 71) to already-authorized,
 * already-ranked retrieval items, and produces the structured Citation each id maps back to.
 * Never called before the ACL filter/reranker stages - only items already cleared for context
 * injection are assigned a citation id.
 */
export function assignCitationIds(items: readonly RetrievalItem[]): {
  readonly items: readonly WithCitation[];
  readonly citations: readonly Citation[];
} {
  const withCitations = items.map((item, index) => ({ item, citationId: `S${index + 1}` }));
  const citations = withCitations.map(({ item, citationId }) => ({
    id: citationId,
    sourceId: item.chunk.sourceId,
    documentId: item.chunk.documentId,
    ...(item.chunk.metadata.title !== undefined ? { title: item.chunk.metadata.title } : {}),
    ...(item.chunk.metadata.uri !== undefined ? { uri: item.chunk.metadata.uri } : {}),
    ...(item.chunk.metadata.page !== undefined ? { page: item.chunk.metadata.page } : {}),
    ...(item.chunk.metadata.section !== undefined ? { section: item.chunk.metadata.section } : {}),
    excerpt: excerptOf(item.chunk.content),
  }));
  return { items: withCitations, citations };
}

export interface CitationValidationResult {
  readonly valid: boolean;
  readonly citedIds: readonly string[];
  /** Citation ids the model text referenced that do not correspond to any real retrieved chunk (Section 74). */
  readonly unknownIds: readonly string[];
}

/**
 * Detects citation ids ([S1], [S2], ...) referenced in model output and checks each against the
 * actually-retrieved set (Section 74) - a model cannot make an unknown id "valid" just by
 * writing it.
 */
export function validateCitations(text: string, citations: readonly Citation[]): CitationValidationResult {
  const known = new Set(citations.map((citation) => citation.id));
  const cited = new Set<string>();
  for (const match of text.matchAll(/\[(S\d+)\]/g)) {
    const id = match[1];
    if (id) cited.add(id);
  }
  const citedIds = [...cited];
  const unknownIds = citedIds.filter((id) => !known.has(id));
  return { valid: unknownIds.length === 0, citedIds, unknownIds };
}
