import { useId } from 'react';
import type { ReactNode } from 'react';

export const formatMs = (ms: number | undefined): string => (ms === undefined ? '-' : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);
export const formatNumber = (value: number | undefined): string => (value === undefined ? '-' : value.toLocaleString('en-US'));
export const shortId = (id: string | undefined): string => (!id ? '-' : id.length > 12 ? `${id.slice(0, 8)}...` : id);
export const formatTime = (iso: string | undefined): string => (iso ? new Date(iso).toISOString().slice(11, 23) : '-');

export type Tone = 'ok' | 'warn' | 'error' | 'info' | 'neutral';

const TONES: Record<string, Tone> = {
  completed: 'ok', succeeded: 'ok', allow: 'ok', ALLOWED: 'ok', approved: 'ok', applied: 'ok', ok: 'ok', validated: 'ok', allowed: 'ok',
  running: 'info', pending: 'info', requested: 'info', open: 'info', paused: 'warn', waiting: 'warn',
  approval: 'warn', WAITING_FOR_APPROVAL: 'warn', required: 'warn', conflict: 'warn', compensated: 'warn', expired: 'warn',
  failed: 'error', error: 'error', deny: 'error', DENIED: 'error', denied: 'error', rejected: 'error', cancelled: 'error',
};

/** A status label - always text, never color alone (Section 171). */
export function Badge({ value, tone }: { readonly value: string; readonly tone?: Tone }): ReactNode {
  return <span className={`badge badge-${tone ?? TONES[value] ?? 'neutral'}`}>{value}</span>;
}

export function PanelHeading({ id, title, description }: { readonly id: string; readonly title: string; readonly description?: string }): ReactNode {
  return (
    <div className="panel-header">
      {/* Focus lands here when the panel is selected (Section 171 focus management). */}
      <h2 id={id} tabIndex={-1}>
        {title}
      </h2>
      {description ? <p className="muted">{description}</p> : null}
    </div>
  );
}

export interface Column<T> {
  readonly header: string;
  readonly cell: (row: T) => ReactNode;
  readonly numeric?: boolean;
}

export function DataTable<T>({ caption, columns, rows, rowKey, empty }: { readonly caption: string; readonly columns: readonly Column<T>[]; readonly rows: readonly T[]; readonly rowKey: (row: T, index: number) => string; readonly empty?: string }): ReactNode {
  if (rows.length === 0) return <p className="empty">{empty ?? 'Nothing recorded.'}</p>;
  return (
    <div className="table-scroll" role="region" aria-label={caption} tabIndex={0}>
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.header} scope="col" className={column.numeric ? 'numeric' : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)}>
              {columns.map((column) => (
                <td key={column.header} className={column.numeric ? 'numeric' : undefined}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KeyValues({ entries }: { readonly entries: readonly (readonly [string, ReactNode])[] }): ReactNode {
  return (
    <dl className="kv">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Safe vs raw view (Section 59). Payloads are already redacted when recorded; the safe view
 * still hides them and shows only that something was captured. Raw view requires a session
 * recorded in `development-verbose` mode, and secrets stay masked even then.
 */
export function Payload({ value, raw, label = 'Payload' }: { readonly value: unknown; readonly raw: boolean; readonly label?: string }): ReactNode {
  if (value === undefined) return <span className="muted">not recorded</span>;
  if (!raw) return <span className="muted">hidden in safe view</span>;
  return (
    <details className="payload">
      <summary>{label}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function Pager({ offset, limit, total, onChange }: { readonly offset: number; readonly limit: number; readonly total: number; readonly onChange: (offset: number) => void }): ReactNode {
  const id = useId();
  if (total <= limit) return null;
  return (
    <nav className="pager" aria-labelledby={id}>
      <span id={id}>
        {offset + 1}-{Math.min(total, offset + limit)} of {total}
      </span>
      <button type="button" onClick={() => onChange(Math.max(0, offset - limit))} disabled={offset === 0} aria-label="Previous page">
        Previous
      </button>
      <button type="button" onClick={() => onChange(offset + limit)} disabled={offset + limit >= total} aria-label="Next page">
        Next
      </button>
    </nav>
  );
}

export function Metric({ label, value }: { readonly label: string; readonly value: ReactNode }): ReactNode {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </div>
  );
}
