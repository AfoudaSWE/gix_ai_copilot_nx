import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { createApiClient } from './api.js';
import type { ApiClient, Me } from './api.js';
import { describeError } from './components.js';
import {
  AgentsSection,
  AuditSection,
  ConversationsSection,
  EvaluationsSection,
  KnowledgeSection,
  McpSection,
  OpenApiSection,
  OverviewSection,
  ProjectsSection,
  ResourcesSection,
  SecuritySection,
  SettingsSection,
  TenantsSection,
  ToolsSection,
  TracesSection,
  UsageSection,
  UsersSection,
} from './sections.js';
import type { SectionProps } from './sections.js';

const ModelsSection = (props: SectionProps) => (
  <ResourcesSection {...props} kind="model" title="Models" description="Providers, models, routing and fallback. API keys are referenced by secret name; a key is never displayed after storage." />
);
const PromptsSection = (props: SectionProps) => (
  <ResourcesSection {...props} kind="prompt" title="Prompts" description="Versioned prompts, promoted draft → staging → production. Runs record the version they used." />
);

/** Navigation (Section 82). `minRole` hides links a role cannot use; the server still enforces. */
export const NAV: readonly { readonly id: string; readonly label: string; readonly component: ComponentType<SectionProps>; readonly operator?: boolean }[] = [
  { id: 'overview', label: 'Overview', component: OverviewSection },
  { id: 'projects', label: 'Projects', component: ProjectsSection },
  { id: 'agents', label: 'Agents', component: AgentsSection },
  { id: 'models', label: 'Models', component: ModelsSection },
  { id: 'tools', label: 'Tools', component: ToolsSection },
  { id: 'openapi', label: 'OpenAPI', component: OpenApiSection },
  { id: 'mcp', label: 'MCP', component: McpSection },
  { id: 'knowledge', label: 'Knowledge', component: KnowledgeSection },
  { id: 'conversations', label: 'Conversations', component: ConversationsSection, operator: true },
  { id: 'prompts', label: 'Prompts', component: PromptsSection },
  { id: 'evaluations', label: 'Evaluations', component: EvaluationsSection },
  { id: 'traces', label: 'Traces', component: TracesSection, operator: true },
  { id: 'security', label: 'Security', component: SecuritySection },
  { id: 'audit', label: 'Audit', component: AuditSection, operator: true },
  { id: 'users', label: 'Users', component: UsersSection },
  { id: 'tenants', label: 'Tenants', component: TenantsSection },
  { id: 'usage', label: 'Usage', component: UsageSection },
  { id: 'settings', label: 'Settings', component: SettingsSection },
];

function routeFromHash(): string {
  const id = globalThis.location?.hash.replace(/^#\/?/, '') ?? '';
  return NAV.some((item) => item.id === id) ? id : 'overview';
}

export interface AppProps {
  readonly baseUrl?: string;
  /** Test/embedding seam; defaults to the browser fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly initialToken?: string;
}

export function App({ baseUrl = '/management/v1', fetchImpl, initialToken }: AppProps) {
  const [token, setToken] = useState(initialToken ?? '');
  const [connected, setConnected] = useState(Boolean(initialToken));
  const [me, setMe] = useState<Me>();
  const [error, setError] = useState<string>();
  const [route, setRoute] = useState(routeFromHash);
  const [rtl, setRtl] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const api: ApiClient = useMemo(() => createApiClient({ baseUrl, token: token || undefined, fetchImpl }), [baseUrl, token, fetchImpl]);

  useEffect(() => {
    const onHash = (): void => setRoute(routeFromHash());
    globalThis.addEventListener?.('hashchange', onHash);
    return () => globalThis.removeEventListener?.('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!connected) return;
    api.get<Me>('/me').then(setMe, (failure: unknown) => {
      setError(describeError(failure));
      setConnected(false);
    });
  }, [api, connected]);

  // Move focus to the new section heading after navigation (screen-reader friendly).
  useEffect(() => {
    mainRef.current?.querySelector<HTMLElement>('h2')?.focus();
  }, [route, me]);

  const navigate = (id: string): void => {
    if (globalThis.location) globalThis.location.hash = `#/${id}`;
    setRoute(id);
  };

  if (!connected || !me) {
    return (
      <main className="connect" dir={rtl ? 'rtl' : 'ltr'}>
        <h1>AI Copilot Platform</h1>
        <form
          aria-label="Sign in"
          onSubmit={(event) => {
            event.preventDefault();
            setError(undefined);
            setConnected(true);
          }}
        >
          <label htmlFor="token">Access token</label>
          <input id="token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} />
          <p className="muted">In production, sign in through your identity provider; the token field is for local development.</p>
          <button type="submit">Sign in</button>
          {error ? (
            <p role="alert" className="error">
              {error}
            </p>
          ) : null}
        </form>
      </main>
    );
  }

  const visible = NAV.filter((item) => !item.operator || ['operator', 'admin', 'owner'].includes(me.role ?? ''));
  const Current = (visible.find((item) => item.id === route) ?? visible[0] ?? NAV[0])?.component ?? OverviewSection;
  return (
    <div className="shell" dir={rtl ? 'rtl' : 'ltr'}>
      {/* Handled in script: this app uses hash routing, so the #main fragment must not navigate. */}
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="topbar">
        <strong>AI Copilot Platform</strong>
        <span className="muted">
          {me.tenantId ?? 'no tenant'} · {me.subject} · {me.role ?? (me.platformAdmin ? 'platform admin' : 'no role')}
        </span>
        <span className="topbar-actions">
          <button type="button" onClick={() => setRtl((value) => !value)} aria-pressed={rtl}>
            {rtl ? 'LTR' : 'RTL'}
          </button>
          <button
            type="button"
            onClick={() => {
              setConnected(false);
              setMe(undefined);
              setToken('');
            }}
          >
            Sign out
          </button>
        </span>
      </header>
      <nav aria-label="Platform sections" className="sidebar">
        <ul>
          {visible.map((item) => (
            <li key={item.id}>
              <a
                href={`#/${item.id}`}
                aria-current={item.id === route ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(item.id);
                }}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <main id="main" ref={mainRef} className="content" tabIndex={-1}>
        <Current api={api} me={me} />
      </main>
    </div>
  );
}
