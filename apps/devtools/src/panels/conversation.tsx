import type { ReactNode } from 'react';
import { contextInspections, conversation, reconstructState, stateIds, stateTimeline } from '@gixcopilot/devtools';
import { useState } from 'react';
import { Badge, DataTable, KeyValues, PanelHeading, Payload, formatTime } from '../components.js';
import type { PanelProps } from './overview.js';

/** Section 30: the ordered conversation exactly as the client received it. */
export function MessagesPanel({ session, raw, runId, headingId }: PanelProps): ReactNode {
  const entries = conversation(session, runId);
  return (
    <section aria-labelledby={headingId}>
      <PanelHeading id={headingId} title="Messages" description={runId ? `Run ${runId}` : 'All runs - select a run in Runs to focus.'} />
      {entries.length === 0 ? <p className="empty">No messages recorded.</p> : null}
      <ol className="conversation">
        {entries.map((entry, index) => {
          if (entry.kind === 'message') {
            return (
              <li key={entry.message.messageId} className={`msg msg-${entry.message.role}`}>
                <span className="msg-role">{entry.message.role}</span> <span className="muted">{formatTime(entry.message.startedAt)}</span>
                {/* Message text is what the client received, already redacted per recording mode. */}
                <p>{entry.message.text}</p>
              </li>
            );
          }
          if (entry.kind === 'tool') {
            return (
              <li key={`${entry.tool.toolCallId}-${index}`} className="msg msg-tool">
                <span className="msg-role">{entry.tool.generativeUi ? 'generative UI' : 'tool call'}</span> <code>{entry.tool.name}</code> <Badge value={entry.tool.status} />
                {entry.tool.error ? <p className="error-text">{entry.tool.error.code}: {entry.tool.error.message}</p> : null}
                <div className="payloads">
                  <Payload value={entry.tool.arguments} raw={raw} label="Arguments" />
                  <Payload value={entry.tool.result} raw={raw} label="Result" />
                </div>
              </li>
            );
          }
          return (
            <li key={entry.approval.approvalId} className="msg msg-approval">
              <span className="msg-role">approval</span> {entry.approval.summary ?? entry.approval.action} <Badge value={entry.approval.status} /> <span className="muted">level {entry.approval.level}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Section 31-34: what the engine actually assembled, its budget, and why items were excluded. */
export function ContextPanel({ session, raw, runId, headingId }: PanelProps): ReactNode {
  const inspections = contextInspections(session, runId);
  const context = inspections.at(-1);
  return (
    <section aria-labelledby={headingId}>
      <PanelHeading id={headingId} title="Context" description={`${inspections.length} resolution(s). Showing the latest.`} />
      {!context ? (
        <p className="empty">No context resolution recorded.</p>
      ) : (
        <>
          <KeyValues
            entries={[
              ['Budget', context.budgetTokens ?? '-'],
              ['Used', context.usedTokens],
              ['Remaining', context.remainingTokens ?? '-'],
              ['Resolution time', `${context.resolutionMs} ms`],
            ]}
          />
          {context.budgetTokens ? (
            <div className="budget" role="img" aria-label={`${context.usedTokens} of ${context.budgetTokens} tokens used`}>
              <div className="budget-used" style={{ width: `${Math.min(100, (context.usedTokens / context.budgetTokens) * 100)}%` }} />
            </div>
          ) : null}
          <DataTable caption="Token contribution by scope" rows={context.byScope} rowKey={(row) => row.scope} columns={[{ header: 'Scope', cell: (row) => row.scope }, { header: 'Items', cell: (row) => row.items, numeric: true }, { header: 'Tokens', cell: (row) => row.estimatedTokens, numeric: true }]} />
          <DataTable
            caption="Included items"
            rows={context.included}
            rowKey={(row) => row.id}
            columns={[
              { header: 'Item', cell: (row) => row.name },
              { header: 'Scope', cell: (row) => row.scope },
              { header: 'Priority', cell: (row) => row.priority },
              { header: 'Sensitivity', cell: (row) => row.sensitivity },
              { header: 'Tokens', cell: (row) => row.estimatedTokens, numeric: true },
              { header: 'Truncated', cell: (row) => (row.truncated ? 'yes' : 'no') },
              { header: 'Text', cell: (row) => <Payload value={row.text} raw={raw} label="Text" /> },
            ]}
          />
          <DataTable caption="Excluded items and why" rows={context.excluded} rowKey={(row) => row.id} empty="Nothing was excluded." columns={[{ header: 'Item', cell: (row) => row.name }, { header: 'Scope', cell: (row) => row.scope }, { header: 'Reason', cell: (row) => <Badge value={row.reason} tone="warn" /> }, { header: 'Detail', cell: (row) => row.detail ?? '-' }]} />
        </>
      )}
    </section>
  );
}

/** Section 35-36, 69-70: revision history and a debug-only reconstruction. */
export function StatePanel({ session, raw, headingId }: PanelProps): ReactNode {
  const ids = stateIds(session);
  const [stateId, setStateId] = useState<string | undefined>(ids[0]);
  const timeline = stateTimeline(session, stateId);
  const revisions = [...new Set(timeline.flatMap((entry) => (entry.outcome === 'applied' && entry.toRevision !== undefined ? [entry.toRevision] : [])))];
  const [revision, setRevision] = useState<number | undefined>(revisions.at(-1));
  const snapshot = stateId !== undefined && revision !== undefined ? reconstructState(session, stateId, revision) : undefined;
  return (
    <section aria-labelledby={headingId}>
      <PanelHeading id={headingId} title="State" description="Shared state revisions, AI patches, conflicts and rejections." />
      {ids.length === 0 ? (
        <p className="empty">No state changes recorded.</p>
      ) : (
        <>
          <label>
            State slot{' '}
            <select value={stateId} onChange={(event) => setStateId(event.target.value)}>
              {ids.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <DataTable
            caption="Revision timeline"
            rows={timeline}
            rowKey={(row, index) => `${row.at}-${index}`}
            columns={[
              { header: 'Time', cell: (row) => formatTime(row.at) },
              { header: 'Origin', cell: (row) => (row.origin === 'model' ? 'AI patch' : row.origin === 'application' ? 'UI / app' : row.origin) },
              { header: 'Op', cell: (row) => row.op ?? '-' },
              { header: 'Revision', cell: (row) => `${row.fromRevision ?? '-'} -> ${row.toRevision ?? '-'}` },
              { header: 'Outcome', cell: (row) => <Badge value={row.outcome} /> },
              { header: 'Reason', cell: (row) => row.reason ?? '-' },
            ]}
          />
          <label>
            Inspect revision{' '}
            <select value={revision} onChange={(event) => setRevision(Number(event.target.value))}>
              {revisions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          {snapshot ? (
            <div className="notice" role="note">
              <strong>{snapshot.notice}</strong>
              <div>{snapshot.available ? <Payload value={snapshot.value} raw={raw} label={`Value at revision ${snapshot.revision}`} /> : 'No recorded value for this revision (metadata-only recording).'}</div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
