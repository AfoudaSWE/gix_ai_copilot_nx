import { useCallback, useEffect, useId, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ApiError } from './api.js';

/** Loads data for a section; errors are shown, never swallowed. */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): { data: T | undefined; error: string | undefined; reload: () => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    load().then(
      (value) => {
        if (!cancelled) setData(value);
      },
      (failure: unknown) => {
        if (!cancelled) setError(describeError(failure));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [...deps, tick]);
  return { data, error, reload: useCallback(() => setTick((value) => value + 1), []) };
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (${error.code})`;
  return error instanceof Error ? error.message : String(error);
}

export function Section({ title, description, actions, children }: { readonly title: string; readonly description?: string; readonly actions?: ReactNode; readonly children: ReactNode }) {
  return (
    <section className="section" aria-labelledby={`section-${title}`}>
      <div className="section-header">
        <h2 id={`section-${title}`} tabIndex={-1}>
          {title}
        </h2>
        {actions}
      </div>
      {description ? <p className="muted">{description}</p> : null}
      {children}
    </section>
  );
}

export function ErrorNote({ error }: { readonly error?: string }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}

export interface Column<T> {
  readonly header: string;
  readonly cell: (row: T) => ReactNode;
}

export function Table<T>({ caption, rows, columns, rowKey, empty = 'Nothing here yet.' }: { readonly caption: string; readonly rows: readonly T[] | undefined; readonly columns: readonly Column<T>[]; readonly rowKey: (row: T) => string; readonly empty?: string }) {
  if (!rows) return <p className="muted">Loading…</p>;
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.header} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.header}>{column.cell(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Field({ label, children, hint }: { readonly label: string; readonly hint?: string; readonly children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint ? <small className="muted">{hint}</small> : null}
    </div>
  );
}

/** A form that reports success/failure in a polite live region and disables while busy. */
export function ActionForm({ label, submitLabel, onSubmit, children }: { readonly label: string; readonly submitLabel: string; readonly onSubmit: (data: FormData) => Promise<string | void>; readonly children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string }>();
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setStatus(undefined);
    onSubmit(new FormData(form)).then(
      (message) => {
        setStatus({ ok: true, message: message ?? 'Saved.' });
        form.reset();
      },
      (error: unknown) => setStatus({ ok: false, message: describeError(error) }),
    ).finally(() => setBusy(false));
  };
  return (
    <form className="action-form" aria-label={label} onSubmit={submit}>
      {children}
      <button type="submit" disabled={busy}>
        {busy ? 'Working…' : submitLabel}
      </button>
      <p role="status" aria-live="polite" className={status?.ok === false ? 'error' : 'muted'}>
        {status?.message ?? ''}
      </p>
    </form>
  );
}

export function Badge({ tone = 'neutral', children }: { readonly tone?: 'neutral' | 'good' | 'warn' | 'bad'; readonly children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export const text = (data: FormData, key: string): string => {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
};
