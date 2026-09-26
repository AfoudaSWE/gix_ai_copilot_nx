import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { categorize, eventLabel, filterEvents, flattenTrace, paginate, severity, traces } from '@gixcopilot/devtools';
import type { EventCategory, EventSeverity } from '@gixcopilot/devtools';
import type { DiagnosticEvent } from '@gixcopilot/telemetry';
import { Badge, PanelHeading, Pager, Payload, formatMs, formatTime, shortId } from '../components.js';
import type { PanelProps } from './overview.js';

const CATEGORIES: readonly EventCategory[] = ['run', 'message', 'model', 'context', 'tool', 'security', 'approval', 'rag', 'memory', 'state', 'generative-ui', 'agent', 'workflow', 'span', 'metric', 'log'];
const PAGE = 50;

/** Section 55-56, 169-170: ordered, filterable, paginated - never thousands of rows at once. */
export function EventsPanel({ session, raw, runId, headingId }: PanelProps): ReactNode {
  const [category, setCategory] = useState<EventCategory | ''>('');
  const [minSeverity, setMinSeverity] = useState<EventSeverity>('info');
  const [text, setText] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<DiagnosticEvent | undefined>();
  const filtered = useMemo(
    () => filterEvents(session.events, { runId, categories: category ? [category] : undefined, minSeverity, text: text || undefined }),
    [session.events, runId, category, minSeverity, text],
  );
  const page = paginate(filtered, { offset, limit: PAGE });
  const reset = (): void => setOffset(0);
  return (
    <section aria-labelledby={headingId}>
      <PanelHeading id={headingId} title="Events" description={`${filtered.length} of ${session.events.length} diagnostics${runId ? ` for run ${shortId(runId)}` : ''}.`} />
      <div className="filters" role="search">
        <label>
          Category{' '}
          <select value={category} onChange={(event) => { setCategory(event.target.value as EventCategory | ''); reset(); }}>
            <option value="">All</option>
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Minimum severity{' '}
          <select value={minSeverity} onChange={(event) => { setMinSeverity(event.target.value as EventSeverity); reset(); }}>
            {(['debug', 'info', 'warn', 'error'] as const).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Search{' '}
          <input type="search" value={text} placeholder="run id, tool, agent, workflow, error code" onChange={(event) => { setText(event.target.value); reset(); }} />
        </label>
      </div>
      <ol className="event-list">
        {page.items.map((event) => (
          <li key={event.id}>
            <button type="button" className="event-row" aria-pressed={selected?.id === event.id} onClick={() => setSelected(event)}>
              <span className="muted">{formatTime(event.timestamp)}</span> <Badge value={severity(event)} tone={severity(event) === 'error' ? 'error' : severity(event) === 'warn' ? 'warn' : 'neutral'} /> <span>{categorize(event)}</span> <code>{eventLabel(event)}</code> <span className="muted">run {shortId(event.correlation.runId)}</span>
            </button>
          </li>
        ))}
      </ol>
      <Pager offset={page.offset} limit={page.limit} total={page.total} onChange={setOffset} />
      {selected ? (
        <aside className="card" aria-label="Event detail">
          <h3>Event detail</h3>
          <dl className="kv compact">
            <div><dt>Event ID</dt><dd>{selected.id}</dd></div>
            <div><dt>Type</dt><dd>{eventLabel(selected)}</dd></div>
            <div><dt>Timestamp</dt><dd>{selected.timestamp}</dd></div>
            <div><dt>Sequence</dt><dd>{selected.type === 'protocol.event' ? selected.event.sequence : '-'}</dd></div>
            <div><dt>Run ID</dt><dd>{selected.correlation.runId ?? '-'}</dd></div>
            <div><dt>Correlation</dt><dd>{[selected.correlation.threadId, selected.correlation.rootRunId, selected.correlation.traceId].filter(Boolean).join(' / ') || '-'}</dd></div>
          </dl>
          <Payload value={selected} raw={raw} label="Full diagnostic" />
        </aside>
      ) : null}
    </section>
  );
}

/** Section 57: waterfall per trace. */
export function TracesPanel({ session, runId, headingId }: PanelProps): ReactNode {
  const list = traces(session).filter((trace) => !runId || trace.runId === runId || flattenTrace(trace).some((node) => node.span.correlation.runId === runId));
  const [traceId, setTraceId] = useState<string | undefined>(list[0]?.traceId);
  const trace = list.find((candidate) => candidate.traceId === traceId) ?? list[0];
  const rows = trace ? flattenTrace(trace) : [];
  const [offset, setOffset] = useState(0);
  const page = paginate(rows, { offset, limit: 100 });
  return (
    <section aria-labelledby={headingId}>
      <PanelHeading id={headingId} title="Traces" description="Span waterfall. Durations are wall-clock; approval waits are human time, not system latency." />
      {list.length === 0 ? (
        <p className="empty">No traces recorded.</p>
      ) : (
        <>
          <label>
            Trace{' '}
            <select value={trace?.traceId} onChange={(event) => { setTraceId(event.target.value); setOffset(0); }}>
              {list.map((candidate) => (
                <option key={candidate.traceId} value={candidate.traceId}>
                  {candidate.rootName} - {formatMs(candidate.durationMs)} - {candidate.spanCount} spans ({candidate.status})
                </option>
              ))}
            </select>
          </label>
          <ol className="waterfall" aria-label="Span waterfall">
            {page.items.map((node) => {
              const total = Math.max(1, trace?.durationMs ?? 1);
              const left = (node.offsetMs / total) * 100;
              const width = Math.max(0.5, ((node.span.durationMs ?? 0) / total) * 100);
              return (
                <li key={node.span.spanId} style={{ paddingInlineStart: `${node.depth * 1.25}rem` }}>
                  <span className="span-name">{node.span.name}</span> <span className="muted">{formatMs(node.span.durationMs)}</span> {node.span.status && node.span.status !== 'ok' ? <Badge value={node.span.status} /> : null}
                  <span className="bar-track" aria-hidden="true">
                    <span className={`bar bar-${node.span.status ?? 'open'}`} style={{ insetInlineStart: `${left}%`, width: `${width}%` }} />
                  </span>
                </li>
              );
            })}
          </ol>
          <Pager offset={page.offset} limit={page.limit} total={page.total} onChange={setOffset} />
        </>
      )}
    </section>
  );
}
