'use client';

import { useCallback, useMemo, useState } from 'react';

/**
 * Enough structured provenance to render one citation (Section 70/76) - structurally
 * identical to `@gixcopilot/rag`'s `Citation`, duck-typed on purpose: `@gixcopilot/react`
 * cannot depend on `@gixcopilot/rag` (Section 8's package boundary keeps retrieval/storage
 * concerns out of the UI layer). By the time a citation reaches this hook, retrieval and
 * authorization have already happened server-side (Section 6's Retrieve -> Authorize -> Send
 * to Model) - this only manages client-side presentation state, never fetches or re-derives
 * anything, and never carries hidden/internal fields (Section 76).
 */
export interface CitationData {
  readonly id: string;
  readonly sourceId?: string;
  readonly documentId?: string;
  readonly title?: string;
  readonly uri?: string;
  readonly page?: number;
  readonly section?: string;
  readonly excerpt?: string;
}

export interface UseCitationsResult {
  readonly citations: readonly CitationData[];
  readonly activeCitationId: string | undefined;
  readonly activeCitation: CitationData | undefined;
  select(id: string | undefined): void;
  getCitation(id: string): CitationData | undefined;
}

/**
 * Headless citation state (Section 75/124) - `citations` is supplied by the caller (typically
 * from a RAG-backed response) rather than fetched here; this hook only tracks which citation,
 * if any, is currently expanded/previewed, keeping that presentation concern out of a custom
 * UI's own state (Section 125's "headless first").
 */
export function useCitations(citations: readonly CitationData[]): UseCitationsResult {
  const [activeCitationId, setActiveCitationId] = useState<string | undefined>(undefined);
  const byId = useMemo(() => new Map(citations.map((citation) => [citation.id, citation] as const)), [citations]);
  const select = useCallback((id: string | undefined) => setActiveCitationId(id !== undefined && byId.has(id) ? id : undefined), [byId]);
  const getCitation = useCallback((id: string) => byId.get(id), [byId]);

  return {
    citations,
    activeCitationId: activeCitationId !== undefined && byId.has(activeCitationId) ? activeCitationId : undefined,
    activeCitation: activeCitationId !== undefined ? byId.get(activeCitationId) : undefined,
    select,
    getCitation,
  };
}
