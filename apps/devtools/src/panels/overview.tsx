import type { ReactNode } from 'react';
import { errors, overview } from '@gixcopilot/devtools';
import type { DevToolsSession, RunRecord } from '@gixcopilot/devtools';
import { Badge, DataTable, Metric, PanelHeading, formatMs, formatNumber, formatTime, shortId } from '../components.js';

export interface PanelProps {
  readonly session: DevToolsSession;
  readonly raw: boolean;
  readonly runId?: string;
  readonly onSelectRun?: (runId: string) => void;
  readonly headingId: string;
}

/** Section 28. */
export function OverviewPanel({ session, headingId }: PanelProps): ReactNode {
  const summary = overview(session);
  return (
    <section aria-labelledby={headingId}>
      <PanelHeading id={headingId} title="Overview" description={`Recording mode: ${summary.mode}${summary.dropped ? ` - ${summary.dropped} old events dropped` : ''}`} />
      <div className="metrics">
        <Metric label="Active run" value={shortId(summary.activeRunId)} />
        <Metric label="Runs" value={`${summary.runs} (${summary.runningRuns} running)`} />
        <Metric label="Models" value={summary.models.join(', ') || '-'} />
        <Metric label="Tokens" value={`${formatNumber(summary.tokens.total)} (${formatNumber(summary.tokens.input)} in / ${formatNumber(summary.tokens.output)} out)`} />
        <Metric label="Latency p50 / p95" value={`${formatMs(summary.latency.p50)} / ${formatMs(summary.latency.p95)}`} />
        <Metric label="Tool calls" value={summary.toolCalls} />
        <Metric label="RAG retrievals" value={summary.retrievals} />
        <Metric label="Memory operations" value={summary.memoryOperations} />
        <Metric label="Agent runs" value={summary.agentRuns} />
        <Metric label="Workflows" value={`${summary.workflows.total} (${summary.workflows.paused} paused, ${summary.workflows.failed} failed)`} />
        <Metric label="Security decisions" value={`${summary.securityDecisions.allow} allow / ${summary.securityDecisions.approval} approval / ${summary.securityDecisions.deny} deny`} />
        <Metric label="Errors" value={summary.errors} />
      </div>
    </section>
  );
}

/** Section 29. */
export function RunsPanel({ session, headingId, onSelectRun, runId }: PanelProps): ReactNode {
  return (
    <section aria-labelledby={headingId}>
      <PanelHeading id={headingId} title="Runs" description="Every copilot, agent and workflow run. Select one to scope the other panels." />
      <DataTable<RunRecord>
        caption="Runs"
        rows={session.runs}
        rowKey={(run) => run.runId}
        columns={[
          { header: 'Run', cell: (run) => <button type="button" className="link" aria-pressed={run.runId === runId} onClick={() => onSelectRun?.(run.runId)}>{shortId(run.runId)}</button> },
          { header: 'Kind', cell: (run) => `${run.kind}${run.label ? `: ${run.label}` : ''}` },
          { header: 'Status', cell: (run) => <Badge value={run.status} /> },
          { header: 'Parent', cell: (run) => shortId(run.parentRunId) },
          { header: 'Started', cell: (run) => formatTime(run.startedAt) },
          { header: 'Latency', cell: (run) => formatMs(run.latencyMs), numeric: true },
          { header: 'Tokens', cell: (run) => formatNumber(run.usage?.totalTokens), numeric: true },
          { header: 'Model', cell: (run) => run.models.map((model) => [model.provider, model.model].filter(Boolean).join('/')).join(', ') || '-' },
          { header: 'Tools', cell: (run) => run.toolCallCount, numeric: true },
          { header: 'Errors', cell: (run) => run.errorCount, numeric: true },
        ]}
      />
      <h3>Errors</h3>
      <DataTable
        caption="Normalized errors"
        rows={errors(session).filter((error) => !runId || error.runId === runId)}
        rowKey={(error) => error.eventId}
        empty="No errors recorded."
        columns={[
          { header: 'Time', cell: (error) => formatTime(error.at) },
          { header: 'Source', cell: (error) => error.source },
          { header: 'Code', cell: (error) => <code>{error.code}</code> },
          { header: 'Message', cell: (error) => error.message },
          { header: 'Retryable', cell: (error) => (error.retryable === undefined ? '-' : error.retryable ? 'yes' : 'no') },
          { header: 'Run', cell: (error) => shortId(error.runId) },
        ]}
      />
    </section>
  );
}
