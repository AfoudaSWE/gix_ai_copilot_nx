import { useState } from 'react';
import type { ReactNode } from 'react';
import { can, formatEstimatedCost } from './api.js';
import type { ApiClient, Environment, Me, Page, Project, Resource, ResourceVersion, UsageRow } from './api.js';
import { ActionForm, Badge, ErrorNote, Field, Section, Table, describeError, text, useLoad } from './components.js';

export interface SectionProps {
  readonly api: ApiClient;
  readonly me: Me;
}

const when = (value: string | undefined): string => (value ? new Date(value).toLocaleString() : '—');
const json = (value: unknown): string => JSON.stringify(value, null, 2);

/* ------------------------------------------------------------------ overview (Section 83) */

export function OverviewSection({ api, me }: SectionProps) {
  const projects = useLoad(() => api.get<Project[]>('/projects'), [api]);
  const resources = useLoad(() => api.get<Resource[]>('/resources'), [api]);
  const usage = useLoad(() => api.get<{ rows: UsageRow[]; costLabel: string }>('/usage?groupBy=kind'), [api]);
  const traces = useLoad(() => (can(me, 'operator') ? api.get<{ runId: string; status: string; errorCount: number }[]>('/traces') : Promise.resolve([])), [api, me]);
  const rows = usage.data?.rows ?? [];
  const sum = (kind: string, pick: (row: UsageRow) => number): number => rows.filter((row) => row.key['kind'] === kind).reduce((total, row) => total + pick(row), 0);
  const cards: [string, string][] = [
    ['Projects', String(projects.data?.length ?? '…')],
    ['Configured resources', String(resources.data?.length ?? '…')],
    ['Requests', String(sum('request', (row) => row.count))],
    ['Tokens', String(sum('model', (row) => row.totalTokens))],
    ['Tool calls', String(sum('tool', (row) => row.count))],
    ['Agent runs', String(sum('agent_run', (row) => row.count))],
    ['Workflow runs', String(sum('workflow_run', (row) => row.count))],
    ['RAG queries', String(sum('rag_query', (row) => row.count))],
    ['Recent runs (traces)', String(traces.data?.length ?? '…')],
    ['Runs with errors', String(traces.data?.filter((trace) => trace.errorCount > 0).length ?? '…')],
    ['Estimated cost', formatEstimatedCost(rows.reduce((total, row) => total + row.estimatedCostMicros, 0))],
  ];
  return (
    <Section title="Overview" description={`Tenant ${me.tenantId ?? '—'} · signed in as ${me.subject} (${me.role ?? 'no role'})`}>
      <ErrorNote error={projects.error ?? usage.error ?? traces.error} />
      <dl className="cards">
        {cards.map(([label, value]) => (
          <div className="card" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">{usage.data?.costLabel}</p>
    </Section>
  );
}

/* -------------------------------------------------------- projects & environments (Section 84) */

export function ProjectsSection({ api, me }: SectionProps) {
  const projects = useLoad(() => api.get<Project[]>('/projects?includeArchived=true'), [api]);
  const [selected, setSelected] = useState<string>();
  const environments = useLoad(() => (selected ? api.get<Environment[]>(`/projects/${selected}/environments`) : Promise.resolve([])), [api, selected]);
  return (
    <Section title="Projects" description="Tenant → Project → Environment. Projects are archived, never deleted.">
      <ErrorNote error={projects.error} />
      <Table
        caption="Projects"
        rows={projects.data}
        rowKey={(project) => project.id}
        columns={[
          { header: 'Name', cell: (project) => project.name },
          { header: 'Slug', cell: (project) => <code>{project.slug}</code> },
          { header: 'Status', cell: (project) => <Badge tone={project.status === 'active' ? 'good' : 'neutral'}>{project.status}</Badge> },
          {
            header: 'Actions',
            cell: (project) => (
              <span className="row-actions">
                <button type="button" onClick={() => setSelected(project.id)} aria-pressed={selected === project.id}>
                  Environments
                </button>
                {can(me, 'admin') && project.status === 'active' ? (
                  <button type="button" onClick={() => void api.send('POST', `/projects/${project.id}/archive`).then(projects.reload)}>
                    Archive
                  </button>
                ) : null}
              </span>
            ),
          },
        ]}
      />
      {selected ? (
        <Table
          caption="Environments"
          rows={environments.data}
          rowKey={(environment) => environment.id}
          columns={[
            { header: 'Environment', cell: (environment) => environment.name },
            { header: 'Production', cell: (environment) => (environment.production ? <Badge tone="warn">production</Badge> : 'no') },
          ]}
        />
      ) : null}
      {can(me, 'admin') ? (
        <ActionForm
          label="Create project"
          submitLabel="Create project"
          onSubmit={async (data) => {
            await api.send('POST', '/projects', { name: text(data, 'name'), slug: text(data, 'slug'), description: text(data, 'description') || undefined });
            projects.reload();
            return 'Project created with development, staging and production environments.';
          }}
        >
          <Field label="Name">{(id) => <input id={id} name="name" required />}</Field>
          <Field label="Slug" hint="lowercase letters, digits, dashes">{(id) => <input id={id} name="slug" required pattern="[a-z0-9][a-z0-9-]*" />}</Field>
          <Field label="Description">{(id) => <input id={id} name="description" />}</Field>
        </ActionForm>
      ) : null}
    </Section>
  );
}

/* ------------------------------------ versioned resources: models, OpenAPI, MCP, knowledge, prompts */

const EXAMPLES: Readonly<Record<string, unknown>> = {
  model: { provider: 'openai', model: 'gpt-4o-mini', apiKeySecret: 'openai-key', tier: 'economy' },
  mcp: { serverId: 'files', transport: 'http', url: 'https://mcp.example.com', tools: [] },
  'knowledge-source': { sourceId: 'handbook', type: 'url', uri: 'https://example.com/handbook', acl: { roles: ['staff'], subjects: [] } },
  prompt: { template: 'You are a helpful support assistant.', variables: [] },
  budget: { scope: 'tenant', limitMicros: 100000000, period: 'month', warnAt: 0.8, action: 'block' },
  'rate-limit': { scope: 'user', limit: 60, windowMs: 60000 },
  'security-policy': { conversationContentAccess: 'none', requireApprovalForDestructive: true, piiRedaction: true },
};

export function ResourcesSection({ api, me, kind, title, description, extra, onChanged }: SectionProps & { readonly kind: string; readonly title: string; readonly description: string; readonly extra?: ReactNode; readonly onChanged?: () => void }) {
  const list = useLoad(() => api.get<Resource[]>(`/resources?kind=${kind}`), [api, kind]);
  const [openId, setOpenId] = useState<string>();
  const detail = useLoad(() => (openId ? api.get<{ resource: Resource; versions: ResourceVersion[] }>(`/resources/${openId}`) : Promise.resolve(undefined)), [api, openId]);
  const [actionError, setActionError] = useState<string>();
  const act = (promise: Promise<unknown>): void => {
    setActionError(undefined);
    promise.then(() => {
      list.reload();
      detail.reload();
      onChanged?.();
    }, (error: unknown) => setActionError(describeError(error)));
  };
  return (
    <Section title={title} description={description}>
      <ErrorNote error={list.error ?? actionError} />
      {extra}
      <Table
        caption={title}
        rows={list.data}
        rowKey={(resource) => resource.id}
        empty={`No ${title.toLowerCase()} configured.`}
        columns={[
          { header: 'Name', cell: (resource) => resource.name },
          { header: 'Scope', cell: (resource) => [resource.projectId ?? 'tenant', resource.environment].filter(Boolean).join(' / ') },
          { header: 'Version', cell: (resource) => `v${resource.currentVersion}` },
          { header: 'Enabled', cell: (resource) => <Badge tone={resource.enabled ? 'good' : 'neutral'}>{resource.enabled ? 'enabled' : 'disabled'}</Badge> },
          {
            header: 'Actions',
            cell: (resource) => (
              <span className="row-actions">
                <button type="button" onClick={() => setOpenId(resource.id)} aria-pressed={openId === resource.id}>
                  Versions
                </button>
                {can(me, 'admin') ? (
                  <button type="button" onClick={() => act(api.send('POST', `/resources/${resource.id}/enabled`, { enabled: !resource.enabled }))}>
                    {resource.enabled ? 'Disable' : 'Enable'}
                  </button>
                ) : null}
              </span>
            ),
          },
        ]}
      />
      {detail.data ? (
        <div className="versions">
          <h3>
            {detail.data.resource.name} — versions
          </h3>
          <ol>
            {detail.data.versions.map((version) => (
              <li key={version.version}>
                <strong>v{version.version}</strong> <Badge tone={version.stage === 'production' ? 'good' : 'neutral'}>{version.stage}</Badge> by {version.createdBy}, {when(version.createdAt)}
                {can(me, 'admin') ? (
                  <span className="row-actions">
                    {kind === 'prompt' && version.stage === 'draft' ? (
                      <button type="button" onClick={() => act(api.send('POST', `/resources/${openId}/versions/${version.version}/promote`, { stage: 'staging' }))}>
                        Promote to staging
                      </button>
                    ) : null}
                    {kind === 'prompt' && version.stage === 'staging' ? (
                      <button type="button" onClick={() => act(api.send('POST', `/resources/${openId}/versions/${version.version}/promote`, { stage: 'production' }))}>
                        Promote to production
                      </button>
                    ) : null}
                    {detail.data?.resource.currentVersion !== version.version ? (
                      <button type="button" onClick={() => act(api.send('POST', `/resources/${openId}/rollback`, { version: version.version }))}>
                        Make current
                      </button>
                    ) : null}
                  </span>
                ) : null}
                <pre className="spec">{json(version.spec)}</pre>
              </li>
            ))}
          </ol>
          {can(me, 'admin') ? (
            <ActionForm
              label="New version"
              submitLabel="Save new version"
              onSubmit={async (data) => {
                await api.send('POST', `/resources/${openId}/versions`, { spec: JSON.parse(text(data, 'spec')) as unknown });
                list.reload();
                detail.reload();
                return 'New version saved (the previous version is kept).';
              }}
            >
              <Field label="Specification (JSON)" hint="Validated by the server; secrets are referenced by name only">
                {(id) => <textarea id={id} name="spec" rows={8} required defaultValue={json(detail.data?.versions.at(-1)?.spec)} />}
              </Field>
            </ActionForm>
          ) : null}
        </div>
      ) : null}
      {can(me, 'admin') ? (
        <ActionForm
          label={`Add ${kind}`}
          submitLabel={`Add ${kind}`}
          onSubmit={async (data) => {
            await api.send('POST', '/resources', { kind, name: text(data, 'name'), spec: JSON.parse(text(data, 'spec')) as unknown, projectId: text(data, 'projectId') || undefined, environment: text(data, 'environment') || undefined });
            list.reload();
            onChanged?.();
          }}
        >
          <Field label="Name">{(id) => <input id={id} name="name" required />}</Field>
          <Field label="Project id (optional)">{(id) => <input id={id} name="projectId" />}</Field>
          <Field label="Environment (optional)">{(id) => <input id={id} name="environment" />}</Field>
          <Field label="Specification (JSON)">{(id) => <textarea id={id} name="spec" rows={6} required defaultValue={json(EXAMPLES[kind] ?? {})} />}</Field>
        </ActionForm>
      ) : null}
    </Section>
  );
}

/* ------------------------------------------------------------------ OpenAPI import (Section 90) */

export function OpenApiSection(props: SectionProps) {
  const { api, me } = props;
  const importer = can(me, 'admin') ? (
    <ActionForm
      label="Import OpenAPI"
      submitLabel="Import (all operations disabled)"
      onSubmit={async (data) => {
        const result = await api.send<{ report: { operationsDiscovered: number } }>('POST', '/openapi/import', { integrationId: text(data, 'integrationId'), document: JSON.parse(text(data, 'document')) as unknown });
        return `Imported ${result.report.operationsDiscovered} operations. None are enabled until you enable them.`;
      }}
    >
      <Field label="Integration id">{(id) => <input id={id} name="integrationId" required />}</Field>
      <Field label="OpenAPI document (JSON)">{(id) => <textarea id={id} name="document" rows={6} required />}</Field>
    </ActionForm>
  ) : null;
  return <ResourcesSection {...props} kind="openapi" title="OpenAPI" description="Imported operations are never exposed automatically. Enable operations and set approval per operation in a new version." extra={importer} />;
}

/* ------------------------------------------------------------- agents & tools catalog (87, 89) */

interface CatalogEntry {
  readonly overrides: readonly (Resource & { readonly spec?: unknown })[];
}

export function AgentsSection({ api }: SectionProps) {
  const agents = useLoad(() => api.get<(CatalogEntry & { id: string; version?: string; tools?: string[]; model?: { provider: string; model: string } })[]>('/agents'), [api]);
  return (
    <Section title="Agents" description="Agents are defined in application code (no dynamic code). The platform can only narrow them (tools, model, limits) through versioned overrides.">
      <ErrorNote error={agents.error} />
      <Table
        caption="Agents"
        rows={agents.data}
        rowKey={(agent) => agent.id}
        columns={[
          { header: 'Agent', cell: (agent) => agent.id },
          { header: 'Version', cell: (agent) => agent.version ?? '—' },
          { header: 'Model', cell: (agent) => (agent.model ? `${agent.model.provider}/${agent.model.model}` : '—') },
          { header: 'Tools', cell: (agent) => (agent.tools ?? []).join(', ') || '—' },
          { header: 'Overrides', cell: (agent) => agent.overrides.map((override) => `v${override.currentVersion}${override.enabled ? '' : ' (disabled)'}`).join(', ') || 'none' },
        ]}
      />
    </Section>
  );
}

export function ToolsSection({ api }: SectionProps) {
  const tools = useLoad(() => api.get<(CatalogEntry & { name: string; description: string; source?: string; risk?: string; approval?: string })[]>('/tools'), [api]);
  return (
    <Section title="Tools" description="Registered tools with their declared risk and approval. Overrides can only make approval stricter. The platform never executes tools.">
      <ErrorNote error={tools.error} />
      <Table
        caption="Tools"
        rows={tools.data}
        rowKey={(tool) => tool.name}
        columns={[
          { header: 'Tool', cell: (tool) => <code>{tool.name}</code> },
          { header: 'Source', cell: (tool) => tool.source ?? 'backend' },
          { header: 'Risk', cell: (tool) => <Badge tone={tool.risk === 'destructive' ? 'bad' : tool.risk === 'write' ? 'warn' : 'neutral'}>{tool.risk ?? 'unclassified'}</Badge> },
          { header: 'Declared approval', cell: (tool) => tool.approval ?? 'none' },
          { header: 'Override', cell: (tool) => tool.overrides.map((override) => (override.spec as { approval?: string } | undefined)?.approval ?? `v${override.currentVersion}`).join(', ') || 'none' },
        ]}
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ MCP status (Section 91) */

export function McpSection(props: SectionProps) {
  const [serverId, setServerId] = useState('');
  const [status, setStatus] = useState<string>();
  const probe = (
    <form
      className="action-form"
      aria-label="Check MCP connection"
      onSubmit={(event) => {
        event.preventDefault();
        props.api.get<{ connected: boolean; error?: string }>(`/mcp/${encodeURIComponent(serverId)}/status`).then(
          (result) => setStatus(result.connected ? 'Connected' : `Not connected: ${result.error ?? 'unknown'}`),
          (error: unknown) => setStatus(describeError(error)),
        );
      }}
    >
      <Field label="Server id">{(id) => <input id={id} value={serverId} onChange={(event) => setServerId(event.target.value)} required />}</Field>
      <button type="submit">Check connection</button>
      <p role="status" aria-live="polite">{status ?? ''}</p>
    </form>
  );
  return <ResourcesSection {...props} kind="mcp" title="MCP" description="MCP servers, their tools and policies. Credentials stay server-side (secret references only); MCP tools still pass the Action Firewall." extra={probe} />;
}

/* ------------------------------------------------------------------ knowledge (Section 92-93) */

export function KnowledgeSection(props: SectionProps) {
  const { api, me } = props;
  const sources = useLoad(() => api.get<Resource[]>('/resources?kind=knowledge-source'), [api]);
  const [status, setStatus] = useState<string>();
  const reindex = can(me, 'operator') ? (
    <div className="row-actions" aria-label="Reindex sources">
      {(sources.data ?? []).map((source) => (
        <button
          key={source.id}
          type="button"
          onClick={() =>
            void api.send<{ jobId: string; duplicate: boolean }>('POST', `/knowledge/${source.id}/reindex`).then(
              (job) => setStatus(job.duplicate ? `Reindex of ${source.name} is already queued.` : `Reindex of ${source.name} queued (${job.jobId}).`),
              (error: unknown) => setStatus(describeError(error)),
            )
          }
        >
          Reindex {source.name}
        </button>
      ))}
      <p role="status" aria-live="polite">{status ?? ''}</p>
    </div>
  ) : null;
  return <ResourcesSection {...props} kind="knowledge-source" title="Knowledge" description="Knowledge sources and permissions. Ingestion runs as background jobs (parse → chunk → embed → index); retrieval enforces ACLs before anything reaches a model." extra={reindex} onChanged={sources.reload} />;
}

/* ------------------------------------------------------------------ conversations (Section 94) */

export function ConversationsSection({ api }: SectionProps) {
  const threads = useLoad(() => api.get<Page<{ id: string; subject?: string; updatedAt: string; projectId?: string }>>('/conversations'), [api]);
  const [threadId, setThreadId] = useState<string>();
  const runs = useLoad(() => (threadId ? api.get<Page<{ id: string; status: string; startedAt: string; usage?: { totalTokens: number }; model?: { provider: string; model: string } }>>(`/conversations/${threadId}/runs`) : Promise.resolve(undefined)), [api, threadId]);
  const messages = useLoad(() => (threadId ? api.get<Page<{ id: string; role: string; content: { type: string; text?: string }[] }>>(`/conversations/${threadId}/messages`) : Promise.resolve(undefined)), [api, threadId]);
  return (
    <Section title="Conversations" description="Conversation metadata is visible to operators. Message content is shown only when the tenant security policy allows it; every access is audited.">
      <ErrorNote error={threads.error} />
      <Table
        caption="Threads"
        rows={threads.data?.items}
        rowKey={(thread) => thread.id}
        columns={[
          { header: 'Thread', cell: (thread) => <code>{thread.id}</code> },
          { header: 'User', cell: (thread) => thread.subject ?? '—' },
          { header: 'Updated', cell: (thread) => when(thread.updatedAt) },
          { header: '', cell: (thread) => <button type="button" onClick={() => setThreadId(thread.id)}>Open</button> },
        ]}
      />
      {threadId ? (
        <>
          <Table
            caption="Runs"
            rows={runs.data?.items}
            rowKey={(run) => run.id}
            columns={[
              { header: 'Run', cell: (run) => <code>{run.id}</code> },
              { header: 'Status', cell: (run) => run.status },
              { header: 'Model', cell: (run) => (run.model ? `${run.model.provider}/${run.model.model}` : '—') },
              { header: 'Tokens', cell: (run) => run.usage?.totalTokens ?? '—' },
            ]}
          />
          {messages.error ? <p className="muted">{messages.error}</p> : null}
          <ol className="messages">
            {(messages.data?.items ?? []).map((message) => (
              <li key={message.id}>
                <strong>{message.role}:</strong> {message.content.map((part) => part.text ?? '').join('')}
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </Section>
  );
}

/* ------------------------------------------------------------------ evaluations (Section 97) */

export function EvaluationsSection({ api, me }: SectionProps) {
  const runs = useLoad(() => api.get<{ id: string; dataset: { id: string; version: string }; startedAt: string; summary?: Record<string, unknown> }[]>('/evals'), [api]);
  const [comparison, setComparison] = useState<unknown>();
  return (
    <Section title="Evaluations" description="Phase 11 evaluation runs. Security hard gates are part of every summary; comparisons flag regressions.">
      <ErrorNote error={runs.error} />
      <Table
        caption="Evaluation runs"
        rows={runs.data}
        rowKey={(run) => run.id}
        columns={[
          { header: 'Run', cell: (run) => <code>{run.id}</code> },
          { header: 'Dataset', cell: (run) => `${run.dataset.id}@${run.dataset.version}` },
          { header: 'Started', cell: (run) => when(run.startedAt) },
          { header: 'Summary', cell: (run) => <code>{JSON.stringify(run.summary ?? {}).slice(0, 120)}</code> },
        ]}
      />
      <ActionForm
        label="Compare runs"
        submitLabel="Compare"
        onSubmit={async (data) => {
          setComparison(await api.get(`/evals/compare/${encodeURIComponent(text(data, 'baseline'))}/${encodeURIComponent(text(data, 'candidate'))}`));
          return 'Comparison ready.';
        }}
      >
        <Field label="Baseline run id">{(id) => <input id={id} name="baseline" required />}</Field>
        <Field label="Candidate run id">{(id) => <input id={id} name="candidate" required />}</Field>
      </ActionForm>
      {comparison ? <pre className="spec">{json(comparison)}</pre> : null}
      {can(me, 'operator') ? (
        <ActionForm
          label="Start evaluation"
          submitLabel="Start evaluation"
          onSubmit={async (data) => {
            const job = await api.send<{ jobId: string }>('POST', '/evals', { datasetId: text(data, 'datasetId'), requestId: `ui-${Date.now()}` });
            return `Evaluation queued (${job.jobId}).`;
          }}
        >
          <Field label="Dataset id">{(id) => <input id={id} name="datasetId" required />}</Field>
        </ActionForm>
      ) : null}
    </Section>
  );
}

/* ------------------------------------------------------------------ traces (Section 98) */

export function TracesSection({ api }: SectionProps) {
  const traces = useLoad(() => api.get<{ runId: string; kind: string; status: string; startedAt?: string; latencyMs?: number; usage?: { totalTokens: number }; errorCount: number }[]>('/traces'), [api]);
  return (
    <Section title="Traces" description="Runs recorded by the Phase 11 telemetry/DevTools pipeline, scoped to this tenant (redacted by default).">
      <ErrorNote error={traces.error} />
      <Table
        caption="Traces"
        rows={traces.data}
        rowKey={(trace) => trace.runId}
        columns={[
          { header: 'Run', cell: (trace) => <code>{trace.runId}</code> },
          { header: 'Kind', cell: (trace) => trace.kind },
          { header: 'Status', cell: (trace) => <Badge tone={trace.status === 'completed' ? 'good' : trace.status === 'failed' ? 'bad' : 'neutral'}>{trace.status}</Badge> },
          { header: 'Latency', cell: (trace) => (trace.latencyMs !== undefined ? `${trace.latencyMs} ms` : '—') },
          { header: 'Tokens', cell: (trace) => trace.usage?.totalTokens ?? '—' },
          { header: 'Errors', cell: (trace) => trace.errorCount },
        ]}
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ security (Section 99) */

export function SecuritySection(props: SectionProps) {
  const overview = useLoad(() => props.api.get<{ policy: Record<string, unknown>; tools: { name: string; risk?: string; approval?: string }[] }>('/security'), [props.api]);
  const summary = (
    <div>
      <ErrorNote error={overview.error} />
      {overview.data ? <pre className="spec">{json(overview.data.policy)}</pre> : null}
    </div>
  );
  return (
    <>
      <ResourcesSection {...props} kind="security-policy" title="Security" description="Effective tenant security policy. Edits require the admin role, are versioned and audited, and cannot weaken code-declared tool approvals." extra={summary} />
      <ResourcesSection {...props} kind="budget" title="Budgets" description="Estimated-cost budgets: warn, throttle, block or route cheaper, only as configured." />
      <ResourcesSection {...props} kind="rate-limit" title="Rate limits" description="Requests per window per tenant, project or user (shared across instances via Redis)." />
    </>
  );
}

/* ------------------------------------------------------------------ audit (Section 100) */

export function AuditSection({ api }: SectionProps) {
  const [filter, setFilter] = useState('');
  const records = useLoad(() => api.get<Page<{ id: string; timestamp: string; actor: { subject?: string; kind: string }; action: string; decision: string; runId?: string }>>(`/audit${filter}`), [api, filter]);
  return (
    <Section title="Audit" description="Immutable audit records for this tenant (read-only).">
      <form
        className="action-form"
        aria-label="Search audit"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const params = new URLSearchParams();
          for (const key of ['actor', 'action', 'decision', 'runId']) if (text(data, key)) params.set(key, text(data, key));
          setFilter(params.size > 0 ? `?${params.toString()}` : '');
        }}
      >
        <Field label="Actor">{(id) => <input id={id} name="actor" />}</Field>
        <Field label="Action">{(id) => <input id={id} name="action" />}</Field>
        <Field label="Decision">{(id) => <input id={id} name="decision" />}</Field>
        <Field label="Run id">{(id) => <input id={id} name="runId" />}</Field>
        <button type="submit">Search</button>
      </form>
      <ErrorNote error={records.error} />
      <Table
        caption="Audit records"
        rows={records.data?.items}
        rowKey={(record) => record.id}
        columns={[
          { header: 'Time', cell: (record) => when(record.timestamp) },
          { header: 'Actor', cell: (record) => record.actor.subject ?? record.actor.kind },
          { header: 'Action', cell: (record) => <code>{record.action}</code> },
          { header: 'Decision', cell: (record) => record.decision },
          { header: 'Correlation', cell: (record) => record.runId ?? '—' },
        ]}
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ users (Section 101) */

export function UsersSection({ api, me }: SectionProps) {
  const members = useLoad(() => api.get<{ subject: string; role: string; projectIds?: string[] }[]>('/memberships'), [api]);
  return (
    <Section title="Users" description="Memberships and roles. Identity (passwords, SSO) stays in your identity provider.">
      <ErrorNote error={members.error} />
      <Table
        caption="Memberships"
        rows={members.data}
        rowKey={(member) => member.subject}
        columns={[
          { header: 'User', cell: (member) => member.subject },
          { header: 'Role', cell: (member) => member.role },
          { header: 'Projects', cell: (member) => member.projectIds?.join(', ') ?? 'all' },
          {
            header: '',
            cell: (member) =>
              can(me, 'owner') && member.subject !== me.subject ? (
                <button type="button" onClick={() => void api.send('DELETE', `/memberships/${encodeURIComponent(member.subject)}`).then(members.reload)}>
                  Remove
                </button>
              ) : null,
          },
        ]}
      />
      {can(me, 'owner') ? (
        <ActionForm
          label="Add or change member"
          submitLabel="Save member"
          onSubmit={async (data) => {
            await api.send('PUT', `/memberships/${encodeURIComponent(text(data, 'subject'))}`, { role: text(data, 'role') });
            members.reload();
          }}
        >
          <Field label="User (subject)">{(id) => <input id={id} name="subject" required />}</Field>
          <Field label="Role">
            {(id) => (
              <select id={id} name="role" defaultValue="viewer">
                <option value="viewer">viewer</option>
                <option value="operator">operator</option>
                <option value="admin">admin</option>
                <option value="owner">owner</option>
              </select>
            )}
          </Field>
        </ActionForm>
      ) : null}
    </Section>
  );
}

/* ------------------------------------------------------------------ tenants (Section 102) */

export function TenantsSection({ api, me }: SectionProps) {
  const tenants = useLoad(() => (me.platformAdmin ? api.get<{ id: string; name: string; status: string }[]>('/tenants') : Promise.resolve([])), [api, me]);
  const tenant = useLoad(() => (me.tenantId ? api.get<{ id: string; name: string; status: string } | null>('/tenant') : Promise.resolve(null)), [api, me]);
  return (
    <Section title="Tenants" description={me.platformAdmin ? 'Platform administration: tenant status and onboarding. Platform administrators do not see tenant data without a membership.' : 'Your tenant.'}>
      <ErrorNote error={tenants.error ?? tenant.error} />
      {tenant.data ? (
        <p>
          <strong>{tenant.data.name}</strong> (<code>{tenant.data.id}</code>) <Badge tone={tenant.data.status === 'active' ? 'good' : 'warn'}>{tenant.data.status}</Badge>
        </p>
      ) : null}
      {me.platformAdmin ? (
        <>
          <Table
            caption="All tenants"
            rows={tenants.data}
            rowKey={(entry) => entry.id}
            columns={[
              { header: 'Tenant', cell: (entry) => entry.name },
              { header: 'Id', cell: (entry) => <code>{entry.id}</code> },
              { header: 'Status', cell: (entry) => entry.status },
              {
                header: '',
                cell: (entry) => (
                  <button type="button" onClick={() => void api.send('POST', `/tenants/${entry.id}/status`, { status: entry.status === 'active' ? 'suspended' : 'active' }).then(tenants.reload)}>
                    {entry.status === 'active' ? 'Suspend' : 'Activate'}
                  </button>
                ),
              },
            ]}
          />
          <ActionForm
            label="Create tenant"
            submitLabel="Create tenant"
            onSubmit={async (data) => {
              await api.send('POST', '/tenants', { id: text(data, 'id'), name: text(data, 'name'), owner: text(data, 'owner') });
              tenants.reload();
            }}
          >
            <Field label="Tenant id">{(id) => <input id={id} name="id" required />}</Field>
            <Field label="Name">{(id) => <input id={id} name="name" required />}</Field>
            <Field label="First owner (subject)">{(id) => <input id={id} name="owner" required />}</Field>
          </ActionForm>
        </>
      ) : null}
    </Section>
  );
}

/* ------------------------------------------------------------------ usage (Section 103-104) */

export function UsageSection({ api }: SectionProps) {
  const [groupBy, setGroupBy] = useState('model');
  const [range, setRange] = useState<'day' | 'month' | 'all'>('month');
  const from = range === 'all' ? '' : new Date(Date.now() - (range === 'day' ? 1 : 30) * 86_400_000).toISOString();
  const usage = useLoad(() => api.get<{ rows: UsageRow[]; costLabel: string }>(`/usage?groupBy=${groupBy}${from ? `&from=${encodeURIComponent(from)}` : ''}`), [api, groupBy, from]);
  return (
    <Section title="Usage" description="Requests, tokens, tools, agents, workflows and RAG. Cost is an estimate from configured pricing, not an invoice.">
      <div className="toolbar">
        <Field label="Group by">
          {(id) => (
            <select id={id} value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
              {['model', 'kind', 'project', 'environment', 'agent', 'tool', 'day', 'month'].map((dimension) => (
                <option key={dimension} value={dimension}>
                  {dimension}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Period">
          {(id) => (
            <select id={id} value={range} onChange={(event) => setRange(event.target.value as 'day' | 'month' | 'all')}>
              <option value="day">Last 24 hours</option>
              <option value="month">Last 30 days</option>
              <option value="all">All time</option>
            </select>
          )}
        </Field>
      </div>
      <ErrorNote error={usage.error} />
      <Table
        caption="Usage"
        rows={usage.data?.rows}
        rowKey={(row) => JSON.stringify(row.key)}
        columns={[
          { header: groupBy, cell: (row) => row.key[groupBy] || '—' },
          { header: 'Count', cell: (row) => row.count },
          { header: 'Input tokens', cell: (row) => row.inputTokens },
          { header: 'Output tokens', cell: (row) => row.outputTokens },
          { header: 'Estimated cost', cell: (row) => (row.pricedEvents > 0 ? formatEstimatedCost(row.estimatedCostMicros) : 'no pricing configured') },
        ]}
      />
      <p className="muted">{usage.data?.costLabel}</p>
    </Section>
  );
}

/* ------------------------------------------------------------------ settings */

export function SettingsSection({ api, me }: SectionProps) {
  const secrets = useLoad(() => (can(me, 'admin') ? api.get<{ name: string; updatedAt: string }[]>('/secrets') : Promise.resolve([])), [api, me]);
  return (
    <Section title="Settings" description="Tenant settings and write-only secrets. Secret values are encrypted server-side and can never be displayed again.">
      {can(me, 'owner') ? (
        <ActionForm
          label="Rename tenant"
          submitLabel="Save name"
          onSubmit={async (data) => {
            await api.send('PATCH', '/tenant', { name: text(data, 'name') });
          }}
        >
          <Field label="Tenant name">{(id) => <input id={id} name="name" required />}</Field>
        </ActionForm>
      ) : null}
      {can(me, 'admin') ? (
        <>
          <ErrorNote error={secrets.error} />
          <Table
            caption="Secrets"
            rows={secrets.data}
            rowKey={(secret) => secret.name}
            empty="No secrets stored."
            columns={[
              { header: 'Name', cell: (secret) => <code>{secret.name}</code> },
              { header: 'Value', cell: () => '•••••• (write-only)' },
              { header: 'Updated', cell: (secret) => when(secret.updatedAt) },
            ]}
          />
          <ActionForm
            label="Store secret"
            submitLabel="Store secret"
            onSubmit={async (data) => {
              await api.send('PUT', `/secrets/${encodeURIComponent(text(data, 'name'))}`, { value: text(data, 'value') });
              secrets.reload();
              return 'Stored. The value cannot be shown again.';
            }}
          >
            <Field label="Secret name">{(id) => <input id={id} name="name" required pattern="[A-Za-z0-9][A-Za-z0-9._-]*" />}</Field>
            <Field label="Secret value">{(id) => <input id={id} name="value" type="password" autoComplete="off" required />}</Field>
          </ActionForm>
        </>
      ) : (
        <p className="muted">Secrets require the admin role.</p>
      )}
    </Section>
  );
}
