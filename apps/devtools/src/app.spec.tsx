import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDevTools, projectSession } from '@gixcopilot/devtools';
import type { DevToolsSession } from '@gixcopilot/devtools';
import type { CopilotEvent } from '@gixcopilot/protocol';
import {
  createFirewallTelemetry,
  createRecordingTelemetry,
  createRetrieverTelemetry,
  createToolTelemetry,
  recordProtocolEvent,
  recordRun,
  withTelemetryMetadata,
} from '@gixcopilot/telemetry';
import type { RecordingTelemetry, TelemetryMode } from '@gixcopilot/telemetry';
import { App } from './app.js';

let sequence = 0;
const event = (type: CopilotEvent['type'], runId: string, body: object): CopilotEvent =>
  ({ type, id: `e${++sequence}`, runId, threadId: 't', sequence, timestamp: new Date(Date.UTC(2026, 8, 27, 10, 0, sequence)).toISOString(), protocolVersion: '1', ...body }) as unknown as CopilotEvent;

/** A small session recorded through REAL telemetry instrumentation - not hand-written JSON. */
async function record(mode: TelemetryMode = 'redacted'): Promise<RecordingTelemetry> {
  const telemetry = createRecordingTelemetry({ mode });
  const correlation = { runId: 'run-1', tenantId: 'tenant-a' };
  const root = telemetry.startSpan('copilot.run', { correlation });
  recordRun(telemetry, { kind: 'copilot', phase: 'started', correlation });
  const tools = createToolTelemetry(telemetry);
  const firewall = createFirewallTelemetry(telemetry, { tracker: tools.tracker });
  for (const [name, decision] of [['applications.get', { decision: 'allow' as const }], ['applications.delete', { decision: 'deny' as const, reason: { code: 'PERMISSION_DENIED', message: 'no' } }]] as const) {
    const toolCallId = `call-${name}`;
    recordProtocolEvent(telemetry, event('tool.requested', 'run-1', { toolCallId, name, arguments: { id: 'APP-1024' }, source: 'native' }));
    await tools.instrument({
      async execute(_invocation: object) {
        const outcome = await firewall.instrument({ evaluate: (_request: object, _context: object) => Promise.resolve(decision) }).evaluate(
          { actionId: toolCallId, runId: 'run-1', toolCallId, action: name, arguments: {}, metadata: {} },
          { identity: { subject: 'officer-1', roles: ['officer'] }, tenant: { tenantId: 'tenant-a' }, metadata: withTelemetryMetadata(undefined, { correlation }) },
        );
        if (outcome.decision !== 'allow') return { status: 'error' as const, toolCallId, error: { code: 'PERMISSION_DENIED' as const, message: 'no', retryable: false } };
        tools.onEvent({ phase: 'started', toolCallId, name });
        return { status: 'success' as const, toolCallId, data: { status: 'under_review', reviewerNote: 'VISIBLE-ONLY-IN-RAW' } };
      },
    }).execute({ toolCallId, name, arguments: { id: 'APP-1024' }, context: { runId: 'run-1', signal: new AbortController().signal, metadata: withTelemetryMetadata(undefined, { parentSpan: root, correlation }) } });
  }
  await createRetrieverTelemetry(telemetry).instrument({
    retrieve: (_query: { text: string }, _context: { securityContext: object; telemetry?: unknown }) => Promise.resolve({ items: [{ citationId: 'S1', item: { chunk: { id: 'k1', content: 'policy text' }, score: 0.91, provenance: { sourceId: 'application-policy', documentId: 'd1' } } }], citations: [{}], diagnostics: { query: 'q', retrievedCount: 1, authorizedCount: 1, excludedCount: 0, rerankedCount: 1, includedCount: 1, exclusions: [] } }),
  }).retrieve({ text: 'q' }, { securityContext: { tenant: { tenantId: 'tenant-a' } }, telemetry: withTelemetryMetadata(undefined, { correlation }) });
  recordProtocolEvent(telemetry, event('agent.run.started', 'agent-1', { agentId: 'orchestrator', agentRunId: 'agent-1' }), { tenantId: 'tenant-a' });
  recordProtocolEvent(telemetry, event('agent.run.completed', 'agent-1', { agentId: 'orchestrator', agentRunId: 'agent-1' }), { tenantId: 'tenant-a' });
  for (const [type, body] of [['workflow.run.started', {}], ['workflow.step.started', { stepId: 'validate', stepType: 'function', attempt: 1 }], ['workflow.step.completed', { stepId: 'validate', attempt: 1 }], ['workflow.run.completed', {}]] as const) {
    recordProtocolEvent(telemetry, event(type, 'wf-1', { workflowId: 'review', workflowRunId: 'wf-1', ...body }), { tenantId: 'tenant-a' });
  }
  for (let index = 0; index < 60; index += 1) recordProtocolEvent(telemetry, event('message.delta', 'run-1', { messageId: 'm1', delta: `${index} ` }), { tenantId: 'tenant-a' });
  recordRun(telemetry, { kind: 'copilot', phase: 'completed', correlation, latencyMs: 120, usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 } });
  root.end('ok');
  return telemetry;
}

let redacted: DevToolsSession;
let verbose: DevToolsSession;

beforeAll(async () => {
  redacted = createDevTools({ source: await record('redacted') }).getSession();
  verbose = createDevTools({ source: await record('development-verbose') }).getSession();
});

afterEach(cleanup);

const tab = (name: string): HTMLElement => screen.getByRole('tab', { name });

describe('DevTools app (Section 26-58, 171-173)', () => {
  it('renders every panel from one session without crashing', () => {
    render(<App initialSession={redacted} />);
    for (const name of ['Overview', 'Runs', 'Messages', 'Context', 'State', 'Tools', 'Generative UI', 'RAG', 'Memory', 'Agents', 'Workflows', 'Security', 'Events', 'Traces', 'Evals']) {
      fireEvent.click(tab(name));
      expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
    }
  });

  it('shows the firewall decision it recorded, never a recomputed one', () => {
    render(<App initialSession={redacted} />);
    fireEvent.click(tab('Security'));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getAllByText('DENIED').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText(/officer-1/).length).toBeGreaterThan(0);
    fireEvent.click(tab('Tools'));
    expect(within(screen.getByRole('tabpanel')).getByText('PERMISSION_DENIED')).toBeTruthy();
  });

  it('keyboard: arrow keys move between tabs, Home/End jump, and selection follows focus', () => {
    render(<App initialSession={redacted} />);
    const overview = tab('Overview');
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowDown' });
    expect(tab('Runs').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('Runs'));
    fireEvent.keyDown(tab('Runs'), { key: 'End' });
    expect(tab('Evals').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tab('Evals'), { key: 'Home' });
    expect(tab('Overview').getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('tab').filter((element) => element.tabIndex === 0)).toHaveLength(1);
  });

  it('has landmarks, a live status region, a skip link and named controls', () => {
    render(<App initialSession={redacted} />);
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'DevTools panels' })).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Skip to panel' })).toBeTruthy();
    for (const button of screen.getAllByRole('button')) expect(button.textContent?.trim() || button.getAttribute('aria-label')).toBeTruthy();
  });

  it('raw view is unavailable for redacted sessions and reveals payloads only for development-verbose ones', () => {
    render(<App initialSession={redacted} />);
    const rawToggle = screen.getByRole('checkbox', { name: 'Raw view' });
    expect((rawToggle as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(tab('Tools'));
    expect(screen.queryByText(/VISIBLE-ONLY-IN-RAW/)).toBeNull();
    cleanup();
    render(<App initialSession={verbose} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Raw view' }));
    fireEvent.click(tab('Tools'));
    expect(screen.getAllByText(/VISIBLE-ONLY-IN-RAW/).length).toBeGreaterThan(0);
  });

  it('pages long event lists instead of rendering everything (Section 170)', () => {
    render(<App initialSession={redacted} />);
    fireEvent.click(tab('Events'));
    const list = screen.getByRole('tabpanel').querySelector('.event-list');
    expect(list?.children.length).toBe(50);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(list?.children.length).toBeGreaterThan(0);
  });

  it('switches layout direction for RTL (Section 172)', () => {
    const { container } = render(<App initialSession={redacted} />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to right-to-left layout' }));
    expect(container.querySelector('.app')?.getAttribute('dir')).toBe('rtl');
  });
});

describe('data sources', () => {
  it('connects with a bearer token and reports a rejected token', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      urls.push(url);
      const auth = new Headers(init?.headers).get('authorization');
      return Promise.resolve(auth === 'Bearer good' ? new Response(JSON.stringify(redacted), { status: 200 }) : new Response('', { status: 401 }));
    });
    render(<App fetchImpl={fetchImpl as unknown as typeof fetch} />);
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'bad' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
      await Promise.resolve();
    });
    expect(screen.getByRole('status').textContent).toContain('rejected');
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'good' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
      await Promise.resolve();
    });
    expect(screen.getByRole('status').textContent).toContain('Connected');
    expect(urls.every((url) => !url.includes('bad') && !url.includes('good'))).toBe(true); // token never in the URL
  });

  it('imports a debug bundle as inert data, and rejects a malformed one', async () => {
    const telemetry = await record();
    const bundle = createDevTools({ source: telemetry }).exportBundle();
    render(<App />);
    const input = screen.getByLabelText('Import debug bundle');
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File([JSON.stringify(bundle)], 'trace.json', { type: 'application/json' })] } });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByRole('status').textContent).toContain('Imported trace.json');
    expect(projectSession(bundle.snapshot).runs.length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['{"nope":1}'], 'bad.json')] } });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByRole('status').textContent).toContain('Import failed');
  });

  it('loads an eval report and shows the security gate', async () => {
    const report = {
      format: 'gixcopilot.eval.run',
      run: {
        id: 'r1', dataset: { id: 'support', version: '1', caseCount: 1 }, snapshot: { model: { provider: 'openai', model: 'gpt-4o-mini' } }, telemetryMode: 'redacted', startedAt: '', completedAt: '',
        results: [{ caseId: 'delete', repetition: 1, adversarial: true, passed: false, record: { runIds: ['run-9'] }, results: [{ evaluatorId: 'permission-compliance', metric: 'permission_compliance', value: 0, passed: false, security: true, evidence: ['UNAUTHORIZED execution of applications.delete'] }], securityViolations: [] }],
        summary: { cases: 1, repetitions: 1, passed: 0, failed: 1, metrics: [{ metric: 'permission_compliance', evaluatorId: 'permission-compliance', cases: 1, mean: 0, min: 0, passRate: 0, security: true, heuristic: false, unit: 'ratio' }], security: { violations: 1, unauthorizedActions: 1, forbiddenToolViolations: 0, approvalBypasses: 0, restrictedKnowledgeLeaks: 0, crossUserMemoryLeaks: 0, gate: 'FAIL' }, latency: {}, tokens: { total: 0, averagePerCase: 0 }, errors: {}, worstCases: [] },
      },
    };
    render(<App />);
    fireEvent.click(tab('Evals'));
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Eval report JSON'), { target: { files: [new File([JSON.stringify(report)], 'eval.json')] } });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('FAIL')).toBeTruthy();
    expect(within(panel).getByText(/UNAUTHORIZED execution of applications.delete/)).toBeTruthy();
    expect(within(panel).getByText('run-9')).toBeTruthy();
  });
});
