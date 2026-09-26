import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { DevToolsSession } from '@gixcopilot/devtools';
import { DevToolsApiError, fetchSession, followStream, sessionFromBundle } from './api.js';
import type { ApiConnection } from './api.js';
import { AgentsPanel, WorkflowsPanel } from './panels/agents.js';
import { ContextPanel, MessagesPanel, StatePanel } from './panels/conversation.js';
import { EvalsPanel } from './panels/evals.js';
import { EventsPanel, TracesPanel } from './panels/events.js';
import { MemoryPanel, RagPanel } from './panels/knowledge.js';
import { OverviewPanel, RunsPanel } from './panels/overview.js';
import type { PanelProps } from './panels/overview.js';
import { GenerativeUiPanel, SecurityPanel, ToolsPanel } from './panels/tools.js';
import { shortId } from './components.js';

/** Section 27 navigation. */
export const TABS = [
  ['overview', 'Overview', OverviewPanel],
  ['runs', 'Runs', RunsPanel],
  ['messages', 'Messages', MessagesPanel],
  ['context', 'Context', ContextPanel],
  ['state', 'State', StatePanel],
  ['tools', 'Tools', ToolsPanel],
  ['generative-ui', 'Generative UI', GenerativeUiPanel],
  ['rag', 'RAG', RagPanel],
  ['memory', 'Memory', MemoryPanel],
  ['agents', 'Agents', AgentsPanel],
  ['workflows', 'Workflows', WorkflowsPanel],
  ['security', 'Security', SecurityPanel],
  ['events', 'Events', EventsPanel],
  ['traces', 'Traces', TracesPanel],
] as const satisfies readonly (readonly [string, string, (props: PanelProps) => ReactNode])[];

type TabId = (typeof TABS)[number][0] | 'evals';
const ALL_TABS: readonly (readonly [TabId, string])[] = [...TABS.map(([id, label]) => [id, label] as const), ['evals', 'Evals']];

interface Source {
  readonly kind: 'api' | 'bundle';
  readonly label: string;
}

export interface AppProps {
  readonly fetchImpl?: typeof fetch;
  readonly initialSession?: DevToolsSession;
}

/**
 * The DevTools shell (Section 26-27, 171-173). It reads a session from the DevTools API or an
 * imported bundle and renders read-only panels. It holds no credentials beyond the token the
 * developer typed, calls no runtime API, and has no control that executes anything.
 */
export function App({ fetchImpl = globalThis.fetch?.bind(globalThis), initialSession }: AppProps = {}): ReactNode {
  const [session, setSession] = useState<DevToolsSession | undefined>(initialSession);
  const [source, setSource] = useState<Source | undefined>(initialSession ? { kind: 'bundle', label: 'preloaded' } : undefined);
  const [tab, setTab] = useState<TabId>('overview');
  const [runId, setRunId] = useState<string | undefined>();
  const [rawRequested, setRawRequested] = useState(false);
  const [dir, setDir] = useState<'ltr' | 'rtl'>('ltr');
  const [status, setStatus] = useState('Not connected. Connect to a host or import a debug bundle.');
  const [connection, setConnection] = useState<ApiConnection>({ baseUrl: '', token: '' });
  const [live, setLive] = useState(false);
  const tabRefs = useRef(new Map<TabId, HTMLButtonElement>());

  // Raw view only for development-verbose recordings (Section 59).
  const rawAllowed = session?.mode === 'development-verbose';
  const raw = rawAllowed && rawRequested;

  const load = useCallback(async (target: ApiConnection) => {
    try {
      const next = await fetchSession(target, fetchImpl);
      setSession(next);
      setSource({ kind: 'api', label: target.baseUrl || window.location.host || 'this host' });
      setStatus(`Connected: ${next.runs.length} runs, ${next.events.length} events.`);
    } catch (error) {
      setStatus(error instanceof DevToolsApiError ? error.message : `Connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [fetchImpl]);

  useEffect(() => {
    if (!live || source?.kind !== 'api') return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(connection), 300);
    };
    followStream(connection, refresh, controller.signal, fetchImpl).catch(() => {
      if (!controller.signal.aborted) setStatus('Live stream disconnected.');
    });
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [live, source?.kind, connection, fetchImpl, load]);

  const select = (next: TabId): void => {
    setTab(next);
    // Move focus to the panel heading once it renders (Section 171).
    requestAnimationFrame(() => document.getElementById(`panel-heading-${next}`)?.focus());
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const keys: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    let nextIndex: number | undefined;
    if (event.key in keys) nextIndex = (index + (keys[event.key] ?? 0) * (dir === 'rtl' && event.key.startsWith('Arrow') && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') ? -1 : 1) + ALL_TABS.length) % ALL_TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = ALL_TABS.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const [nextTab] = ALL_TABS[nextIndex] ?? [];
    if (!nextTab) return;
    setTab(nextTab);
    tabRefs.current.get(nextTab)?.focus();
  };

  const Panel = TABS.find(([id]) => id === tab)?.[2];
  const headingId = `panel-heading-${tab}`;

  return (
    <div className="app" dir={dir}>
      <a className="skip-link" href="#devtools-main">
        Skip to panel
      </a>
      <header className="topbar">
        <h1>AI Copilot DevTools</h1>
        <form
          className="connect"
          aria-label="Connect to a host"
          onSubmit={(event) => {
            event.preventDefault();
            void load(connection);
          }}
        >
          <label>
            Host <input value={connection.baseUrl} placeholder="(same origin)" onChange={(event) => setConnection({ ...connection, baseUrl: event.target.value })} />
          </label>
          <label>
            Token <input type="password" autoComplete="off" value={connection.token} onChange={(event) => setConnection({ ...connection, token: event.target.value })} />
          </label>
          <label>
            Tenant <input value={connection.tenant ?? ''} placeholder="(all)" onChange={(event) => setConnection({ ...connection, tenant: event.target.value || undefined })} />
          </label>
          <button type="submit">Connect</button>
          <label className="inline">
            <input type="checkbox" checked={live} disabled={source?.kind !== 'api'} onChange={(event) => setLive(event.target.checked)} /> Live
          </label>
        </form>
        <label className="file">
          Import debug bundle{' '}
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file.text().then((text) => {
                try {
                  const { session: imported, bundle } = sessionFromBundle(text);
                  setSession(imported);
                  setSource({ kind: 'bundle', label: file.name });
                  setLive(false);
                  setStatus(`Imported ${file.name}: ${bundle.metadata.eventCount} events (${bundle.mode}). Import never executes anything.`);
                } catch (error) {
                  setStatus(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
                }
              });
            }}
          />
        </label>
        <div className="toggles">
          <label className="inline" title={rawAllowed ? 'Show recorded payloads (secrets stay masked)' : 'Raw view needs a development-verbose recording'}>
            <input type="checkbox" checked={raw} disabled={!rawAllowed} onChange={(event) => setRawRequested(event.target.checked)} /> Raw view
          </label>
          <button type="button" onClick={() => setDir(dir === 'ltr' ? 'rtl' : 'ltr')} aria-label={`Switch to ${dir === 'ltr' ? 'right-to-left' : 'left-to-right'} layout`}>
            {dir === 'ltr' ? 'RTL' : 'LTR'}
          </button>
        </div>
      </header>
      <p className="status" role="status" aria-live="polite">
        {status}
        {source ? ` Source: ${source.label}.` : ''}
      </p>
      <div className="layout">
        <nav className="sidebar" aria-label="DevTools panels">
          <div role="tablist" aria-orientation="vertical" aria-label="Panels">
            {ALL_TABS.map(([id, label], index) => (
              <button
                key={id}
                ref={(element) => {
                  if (element) tabRefs.current.set(id, element);
                }}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={tab === id}
                aria-controls="devtools-main"
                tabIndex={tab === id ? 0 : -1}
                onClick={() => select(id)}
                onKeyDown={(event) => onTabKey(event, index)}
              >
                {label}
              </button>
            ))}
          </div>
          {session && session.runs.length > 0 ? (
            <label className="run-filter">
              Scope to run{' '}
              <select value={runId ?? ''} onChange={(event) => setRunId(event.target.value || undefined)}>
                <option value="">All runs</option>
                {session.runs.map((run) => (
                  <option key={run.runId} value={run.runId}>
                    {run.kind} {run.label ?? ''} {shortId(run.runId)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </nav>
        <main id="devtools-main" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1}>
          {tab === 'evals' ? (
            <EvalsPanel headingId={headingId} />
          ) : session && Panel ? (
            <Panel session={session} raw={raw} runId={runId} onSelectRun={setRunId} headingId={headingId} />
          ) : (
            <p className="empty">Connect to a host with DevTools enabled, or import a debug bundle, to start inspecting.</p>
          )}
        </main>
      </div>
    </div>
  );
}
