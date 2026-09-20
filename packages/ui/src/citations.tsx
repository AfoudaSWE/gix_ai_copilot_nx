import type { ReactElement } from 'react';
import type { CitationData } from '@gixcopilot/react';

export interface SourcePreviewProps { readonly citation: CitationData }
export interface CitationListProps { readonly citations: readonly CitationData[] }

/** Render safe text only; source URLs and internal authorization metadata are never linked. */
export function SourcePreview({ citation }: SourcePreviewProps): ReactElement {
  return <div className="copilot-source-preview">
    {citation.page !== undefined && <p>Page {citation.page}</p>}
    {citation.section && <p>{citation.section}</p>}
    {citation.excerpt && <blockquote>{citation.excerpt}</blockquote>}
  </div>;
}

/** Native keyboard-accessible disclosure for one server-authorized source. */
export function Citation({ citation }: SourcePreviewProps): ReactElement {
  return <details className="copilot-citation">
    <summary>[{citation.id}] {citation.title ?? 'Source'}</summary>
    <SourcePreview citation={citation} />
  </details>;
}

/** Headless data remains usable independently of this optional default presentation. */
export function CitationList({ citations }: CitationListProps): ReactElement {
  return <section aria-label="Sources" className="copilot-citations">
    {citations.map((citation) => <Citation key={citation.id} citation={citation} />)}
  </section>;
}
