import type { EvalDataset, EvalRun, ReproducibilitySnapshot } from './types.js';
import { createEvalRunner } from './runner.js';
import type { EvalRunnerOptions } from './runner.js';

export interface MetricDelta {
  readonly evaluatorId: string;
  readonly metric: string;
  readonly baseline: number;
  readonly candidate: number;
  readonly delta: number;
  readonly unit: string;
}

export interface EvalComparison {
  readonly baselineRunId: string;
  readonly candidateRunId: string;
  /** False when the dataset id/version differ - deltas are then not meaningful. */
  readonly comparable: boolean;
  readonly warnings: readonly string[];
  readonly deltas: readonly MetricDelta[];
  readonly newlyFailingCases: readonly string[];
  readonly newlyPassingCases: readonly string[];
  readonly regressions: readonly string[];
}

const LOWER_IS_BETTER = new Set(['ms', 'tokens', 'currency']);

/**
 * Baseline vs candidate (Section 121): metric deltas, newly failing cases and new security
 * violations. A quality metric dropping by more than `tolerance`, a latency/token/cost metric
 * rising by more than `costTolerance` (relative), any newly failing case, or ANY new security
 * violation is a regression.
 */
export function compareEvalRuns(baseline: EvalRun, candidate: EvalRun, options: { readonly tolerance?: number; readonly costTolerance?: number } = {}): EvalComparison {
  const tolerance = options.tolerance ?? 0.02;
  const costTolerance = options.costTolerance ?? 0.25;
  const warnings: string[] = [];
  const comparable = baseline.dataset.id === candidate.dataset.id && baseline.dataset.version === candidate.dataset.version;
  if (!comparable) warnings.push(`Datasets differ (${baseline.dataset.id}@${baseline.dataset.version} vs ${candidate.dataset.id}@${candidate.dataset.version}).`);

  const deltas: MetricDelta[] = [];
  const regressions: string[] = [];
  for (const metric of candidate.summary.metrics) {
    const before = baseline.summary.metrics.find((entry) => entry.evaluatorId === metric.evaluatorId);
    if (!before) continue;
    const delta = metric.mean - before.mean;
    deltas.push({ evaluatorId: metric.evaluatorId, metric: metric.metric, baseline: before.mean, candidate: metric.mean, delta, unit: metric.unit });
    if (LOWER_IS_BETTER.has(metric.unit)) {
      if (before.mean > 0 && delta / before.mean > costTolerance) regressions.push(`${metric.metric} rose ${((delta / before.mean) * 100).toFixed(0)}% (${before.mean.toFixed(2)} -> ${metric.mean.toFixed(2)} ${metric.unit})`);
    } else if (delta < -tolerance) {
      regressions.push(`${metric.metric} fell ${(delta * 100).toFixed(1)} points (${(before.mean * 100).toFixed(1)}% -> ${(metric.mean * 100).toFixed(1)}%)`);
    }
  }

  const failing = (run: EvalRun): Set<string> => new Set(run.results.filter((result) => !result.passed).map((result) => result.caseId));
  const before = failing(baseline);
  const after = failing(candidate);
  const newlyFailingCases = [...after].filter((caseId) => !before.has(caseId));
  const newlyPassingCases = [...before].filter((caseId) => !after.has(caseId));
  for (const caseId of newlyFailingCases) regressions.push(`case ${caseId} now fails`);
  if (candidate.summary.security.violations > baseline.summary.security.violations) {
    regressions.push(`security violations increased ${baseline.summary.security.violations} -> ${candidate.summary.security.violations}`);
  }
  return { baselineRunId: baseline.id, candidateRunId: candidate.id, comparable, warnings, deltas, newlyFailingCases, newlyPassingCases, regressions };
}

export interface ExperimentVariant<TInput> {
  readonly id: string;
  readonly target: EvalRunnerOptions<TInput>['target'];
  readonly snapshot: ReproducibilitySnapshot;
}

export interface ExperimentResult {
  readonly runs: readonly EvalRun[];
  /** Quality next to latency, tokens and cost - a better score that costs 10x is shown as a
   * trade-off, never hidden (ai-evals skill). */
  readonly table: readonly {
    readonly variant: string;
    readonly passed: number;
    readonly cases: number;
    readonly securityGate: 'PASS' | 'FAIL';
    readonly p95LatencyMs?: number;
    readonly averageTokens: number;
    readonly estimatedCostPerCase?: number;
    readonly metrics: Readonly<Record<string, number>>;
  }[];
}

/**
 * Model / prompt / configuration comparison (Section 123-125) over one dataset: each variant
 * is just a different target plus the snapshot describing it (model A vs B, prompt v1 vs v2,
 * RAG K=5 vs K=10, memory on vs off). The eval core never knows which provider is involved.
 */
export async function runExperiment<TInput>(
  dataset: EvalDataset<TInput>,
  variants: readonly ExperimentVariant<TInput>[],
  shared: Omit<EvalRunnerOptions<TInput>, 'target' | 'snapshot' | 'label'> = {},
): Promise<ExperimentResult> {
  const runs: EvalRun[] = [];
  for (const variant of variants) runs.push(await createEvalRunner({ ...shared, target: variant.target, snapshot: variant.snapshot, label: variant.id }).run(dataset));
  return {
    runs,
    table: runs.map((run) => ({
      variant: run.label ?? run.id,
      passed: run.summary.passed,
      cases: run.summary.cases,
      securityGate: run.summary.security.gate,
      p95LatencyMs: run.summary.latency.p95,
      averageTokens: run.summary.tokens.averagePerCase,
      estimatedCostPerCase: run.summary.cost?.averagePerCase,
      metrics: Object.fromEntries(run.summary.metrics.map((metric) => [metric.evaluatorId, metric.mean])),
    })),
  };
}
