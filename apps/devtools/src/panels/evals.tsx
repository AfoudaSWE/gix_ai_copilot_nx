import { useState } from 'react';
import type { ReactNode } from 'react';
import type { EvalRun } from '@gixcopilot/evals';
import { evalRunFromJson } from '../api.js';
import { Badge, DataTable, Metric, PanelHeading, formatMs } from '../components.js';
import type { PanelProps } from './overview.js';

function formatValue(value: number, unit: string): string {
  if (unit === 'ms') return formatMs(value);
  if (unit === 'tokens') return `${Math.round(value)} tokens`;
  if (unit === 'currency') return `${value.toFixed(6)} (estimate)`;
  return `${(value * 100).toFixed(1)}%`;
}

/** Section 138: an eval report viewer - load the JSON written by `toEvalJson` (e.g. from CI). */
export function EvalsPanel({ headingId }: Pick<PanelProps, 'headingId'>): ReactNode {
  const [run, setRun] = useState<EvalRun | undefined>();
  const [error, setError] = useState<string | undefined>();
  return (
    <section aria-labelledby={headingId}>
      <PanelHeading id={headingId} title="Evals" description="Load an eval report (JSON from @gixcopilot/evals) to review metrics, security gate and failures." />
      <label className="file">
        Eval report JSON{' '}
        <input
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void file.text().then((text) => {
              try {
                setRun(evalRunFromJson(text));
                setError(undefined);
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : String(caught));
              }
            });
          }}
        />
      </label>
      {error ? <p role="alert" className="error-text">{error}</p> : null}
      {run ? (
        <>
          <div className="metrics">
            <Metric label="Dataset" value={`${run.dataset.id}@${run.dataset.version}`} />
            <Metric label="Model" value={[run.snapshot.model?.provider, run.snapshot.model?.model].filter(Boolean).join('/') || 'not recorded'} />
            <Metric label="Passed" value={`${run.summary.passed} / ${run.summary.cases}`} />
            <Metric label="Security gate" value={<Badge value={run.summary.security.gate} tone={run.summary.security.gate === 'PASS' ? 'ok' : 'error'} />} />
            <Metric label="P95 latency" value={formatMs(run.summary.latency.p95)} />
            <Metric label="Avg tokens" value={Math.round(run.summary.tokens.averagePerCase)} />
          </div>
          <DataTable
            caption="Metrics"
            rows={run.summary.metrics}
            rowKey={(metric) => metric.evaluatorId}
            columns={[
              { header: 'Metric', cell: (metric) => metric.metric },
              { header: 'Mean', cell: (metric) => formatValue(metric.mean, metric.unit), numeric: true },
              { header: 'Pass rate', cell: (metric) => (metric.passRate === undefined ? '-' : `${(metric.passRate * 100).toFixed(1)}%`), numeric: true },
              { header: 'Flags', cell: (metric) => [metric.security ? 'security gate' : '', metric.heuristic ? 'heuristic' : ''].filter(Boolean).join(', ') || '-' },
            ]}
          />
          <DataTable
            caption="Failed cases"
            rows={run.results.filter((result) => !result.passed)}
            rowKey={(result) => `${result.caseId}-${result.repetition}`}
            empty="Every case passed."
            columns={[
              { header: 'Case', cell: (result) => result.caseId },
              { header: 'Failed metrics', cell: (result) => result.results.filter((entry) => entry.passed === false).map((entry) => entry.metric).join(', ') },
              { header: 'Evidence', cell: (result) => result.results.filter((entry) => entry.passed === false).flatMap((entry) => entry.evidence).slice(0, 3).join('; ') },
              { header: 'Runs (triage)', cell: (result) => result.record.runIds.join(', ') || '-' },
            ]}
          />
        </>
      ) : null}
    </section>
  );
}
