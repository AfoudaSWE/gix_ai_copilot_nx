import type { ReactNode } from 'react';
import { citations, memoryTimeline, retrievals } from '@gixcopilot/devtools';
import { Badge, DataTable, PanelHeading, Payload, formatMs, formatTime, shortId } from '../components.js';
import type { PanelProps } from './overview.js';

/** Section 43-45, 222: why a chunk reached the model - or did not. */
export function RagPanel({ session, raw, runId, headingId }: PanelProps): ReactNode {
  const list = retrievals(session, runId);
  return (
    <section aria-labelledby={headingId}>
      <PanelHeading id={headingId} title="RAG" description="Query, retriever, ACL filter, reranker, prompt context and citations - as recorded." />
      {list.length === 0 ? <p className="empty">No retrievals recorded.</p> : null}
      {list.map((retrieval) => (
        <article key={retrieval.retrievalId} className="card">
          <h3>
            Retrieval {shortId(retrieval.retrievalId)} <span className="muted">({formatMs(retrieval.durationMs)}, top-K {retrieval.topK ?? '-'})</span>
          </h3>
          <p className="muted">Query: {raw ? (retrieval.query ?? 'not recorded') : 'hidden in safe view'}</p>
          <ol className="pipeline" aria-label="Retrieval pipeline">
            {retrieval.pipeline.map((stage) => (
              <li key={stage.stage}>
                <span>{stage.stage}</span> <strong>{stage.count}</strong>
              </li>
            ))}
          </ol>
          <DataTable
            caption="Candidates"
            rows={retrieval.candidates}
            rowKey={(candidate) => candidate.chunkId}
            columns={[
              { header: 'Source', cell: (candidate) => candidate.sourceId ?? '-' },
              { header: 'Chunk', cell: (candidate) => shortId(candidate.chunkId) },
              { header: 'Score', cell: (candidate) => (candidate.score === undefined ? '-' : candidate.score.toFixed(3)), numeric: true },
              { header: 'In context', cell: (candidate) => <Badge value={candidate.selected ? 'selected' : 'excluded'} tone={candidate.selected ? 'ok' : 'warn'} /> },
              { header: 'Why excluded', cell: (candidate) => candidate.exclusionReason ?? '-' },
              { header: 'Citation', cell: (candidate) => candidate.citationId ?? '-' },
              { header: 'Excerpt', cell: (candidate) => <Payload value={candidate.excerpt} raw={raw} label="Excerpt" /> },
            ]}
          />
        </article>
      ))}
      <h3>Citations</h3>
      <DataTable
        caption="Citations"
        rows={citations(session, runId)}
        rowKey={(citation) => `${citation.retrievalId}-${citation.citationId}`}
        empty="No citations recorded."
        columns={[
          { header: 'Citation', cell: (citation) => citation.citationId },
          { header: 'Source', cell: (citation) => citation.title ?? citation.sourceId ?? '-' },
          { header: 'Chunk', cell: (citation) => shortId(citation.chunkId) },
          { header: 'Score', cell: (citation) => (citation.score === undefined ? '-' : citation.score.toFixed(3)), numeric: true },
          { header: 'Was in context', cell: (citation) => (citation.inContext ? 'yes' : 'NO') },
        ]}
      />
    </section>
  );
}

/** Section 46-47: memory the viewer may see - never other users' memory. */
export function MemoryPanel({ session, raw, runId, headingId }: PanelProps): ReactNode {
  return (
    <section aria-labelledby={headingId}>
      <PanelHeading id={headingId} title="Memory" description="Reads, searches and writes. Other users' memory is never shown." />
      <DataTable
        caption="Memory operations"
        rows={memoryTimeline(session, runId)}
        rowKey={(entry, index) => `${entry.at}-${index}`}
        empty="No memory operations recorded."
        columns={[
          { header: 'Time', cell: (entry) => formatTime(entry.at) },
          { header: 'Operation', cell: (entry) => entry.operation },
          { header: 'Type', cell: (entry) => entry.memoryType ?? '-' },
          { header: 'Owner', cell: (entry) => (entry.ownerId ? `${entry.ownerType ?? ''}:${entry.ownerId}` : '-') },
          { header: 'Outcome', cell: (entry) => <Badge value={entry.outcome} /> },
          { header: 'Results', cell: (entry) => entry.resultCount ?? '-', numeric: true },
          { header: 'Provenance', cell: (entry) => entry.provenance ?? '-' },
          { header: 'Value', cell: (entry) => <Payload value={entry.value} raw={raw} label="Value" /> },
        ]}
      />
    </section>
  );
}
