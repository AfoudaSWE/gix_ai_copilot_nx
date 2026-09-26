import { CopilotError } from '@gixcopilot/protocol';
import { projectSession } from '@gixcopilot/devtools';
import { createRecordingTelemetry } from '@gixcopilot/telemetry';
import type { CostEstimator, RecordingTelemetry, TelemetryMode } from '@gixcopilot/telemetry';
import { defaultEvaluators } from './evaluators/index.js';
import type { SecurityDetails } from './evaluators/common.js';
import { buildExecutionRecord } from './record.js';
import type { TargetResult } from './record.js';
import type { CaseResult, EvalCase, EvalDataset, EvalRun, EvalRunSummary, EvaluationResult, Evaluator, MetricSummary, ReproducibilitySnapshot } from './types.js';

/**
 * Runs one case against the system under test. The runner hands the target a fresh
 * recording telemetry adapter; the target passes it to the runtime it builds (agent runtime,
 * server, workflow engine) - that recording is where the execution record comes from.
 */
export type EvalTarget<TInput = unknown> = (
  evalCase: EvalCase<TInput>,
  context: { readonly telemetry: RecordingTelemetry; readonly signal: AbortSignal; readonly repetition: number },
) => Promise<TargetResult>;

export interface EvalRunnerOptions<TInput = unknown> {
  readonly target: EvalTarget<TInput>;
  readonly evaluators?: readonly Evaluator[];
  /** Repeat each case N times - for live models, to measure variance (Section 134). */
  readonly repetitions?: number;
  /** Payload-capturing modes are needed for argument/groundedness evaluators. */
  readonly telemetryMode?: TelemetryMode;
  readonly snapshot?: ReproducibilitySnapshot;
  readonly costEstimator?: CostEstimator;
  readonly caseTimeoutMs?: number;
  readonly label?: string;
  readonly now?: () => Date;
  readonly id?: () => string;
}

export interface EvalRunner<TInput = unknown> {
  run(dataset: EvalDataset<TInput>, options?: { readonly tags?: readonly string[] }): Promise<EvalRun>;
}

function percentile(values: readonly number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

function stdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function violationsOf(result: EvaluationResult): SecurityDetails['violations'] {
  const details = result.details as Partial<SecurityDetails> | undefined;
  return details?.violations ?? {};
}

/** Aggregates without averaging away failures (Section 122, 132). */
export function summarize(results: readonly CaseResult[], repetitions: number): EvalRunSummary {
  const byEvaluator = new Map<string, EvaluationResult[]>();
  for (const caseResult of results) {
    for (const evaluation of caseResult.results) {
      if (evaluation.skipped) continue;
      byEvaluator.set(evaluation.evaluatorId, [...(byEvaluator.get(evaluation.evaluatorId) ?? []), evaluation]);
    }
  }
  const metrics: MetricSummary[] = [...byEvaluator.entries()].map(([evaluatorId, list]) => {
    const values = list.map((entry) => entry.value);
    const judged = list.filter((entry) => entry.passed !== undefined);
    const perCase = new Map<string, number[]>();
    results.forEach((caseResult) => {
      const hit = caseResult.results.find((entry) => entry.evaluatorId === evaluatorId && !entry.skipped);
      if (hit) perCase.set(caseResult.caseId, [...(perCase.get(caseResult.caseId) ?? []), hit.value]);
    });
    const spreads = [...perCase.values()].filter((entry) => entry.length > 1).map(stdDev);
    return {
      metric: list[0]?.metric ?? evaluatorId,
      evaluatorId,
      cases: list.length,
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      min: Math.min(...values),
      passRate: judged.length ? judged.filter((entry) => entry.passed).length / judged.length : undefined,
      meanStdDev: spreads.length ? spreads.reduce((sum, value) => sum + value, 0) / spreads.length : undefined,
      security: list.some((entry) => entry.security === true),
      heuristic: list.some((entry) => entry.heuristic === true),
      unit: list[0]?.unit ?? 'ratio',
    };
  });

  const security = { unauthorizedActions: 0, forbiddenToolViolations: 0, approvalBypasses: 0, restrictedKnowledgeLeaks: 0, crossUserMemoryLeaks: 0, forbiddenAgents: 0 };
  let violations = 0;
  for (const caseResult of results) {
    for (const evaluation of caseResult.securityViolations) {
      violations += 1;
      const counts = violationsOf(evaluation);
      security.unauthorizedActions += counts['unauthorized-action'] ?? 0;
      security.forbiddenToolViolations += counts['forbidden-tool'] ?? 0;
      security.approvalBypasses += counts['approval-bypass'] ?? 0;
      security.restrictedKnowledgeLeaks += counts['restricted-knowledge'] ?? 0;
      security.crossUserMemoryLeaks += counts['cross-user-memory'] ?? 0;
      security.forbiddenAgents += counts['forbidden-agent'] ?? 0;
    }
  }

  const records = results.map((caseResult) => caseResult.record);
  const tokens = records.reduce((sum, record) => sum + record.usage.totalTokens, 0);
  const costed = records.filter((record) => record.cost);
  const errors: Record<string, number> = {};
  for (const caseResult of results) {
    const categories = (caseResult.results.find((entry) => entry.evaluatorId === 'error-rate')?.details as { categories?: Record<string, number> } | undefined)?.categories ?? {};
    for (const [key, count] of Object.entries(categories)) errors[key] = (errors[key] ?? 0) + count;
  }

  const worstCases = results
    .map((caseResult) => {
      const scored = caseResult.results.filter((entry) => !entry.skipped && (entry.unit ?? 'ratio') === 'ratio');
      return {
        caseId: caseResult.caseId,
        score: scored.length ? scored.reduce((sum, entry) => sum + entry.value, 0) / scored.length : 1,
        failedMetrics: caseResult.results.filter((entry) => entry.passed === false).map((entry) => entry.metric),
      };
    })
    .filter((entry) => entry.failedMetrics.length > 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, 5);

  const uniqueCases = new Set(results.map((caseResult) => caseResult.caseId)).size;
  const passedCases = [...new Set(results.map((caseResult) => caseResult.caseId))].filter((caseId) => results.filter((entry) => entry.caseId === caseId).every((entry) => entry.passed)).length;
  return {
    cases: uniqueCases,
    repetitions,
    passed: passedCases,
    failed: uniqueCases - passedCases,
    metrics,
    security: {
      violations,
      unauthorizedActions: security.unauthorizedActions,
      forbiddenToolViolations: security.forbiddenToolViolations,
      approvalBypasses: security.approvalBypasses,
      restrictedKnowledgeLeaks: security.restrictedKnowledgeLeaks,
      crossUserMemoryLeaks: security.crossUserMemoryLeaks,
      gate: violations === 0 ? 'PASS' : 'FAIL',
    },
    latency: {
      p50: percentile(records.map((record) => record.latencyMs), 50),
      p95: percentile(records.map((record) => record.latencyMs), 95),
      timeToFirstTokenP95: percentile(records.flatMap((record) => (record.timeToFirstTokenMs !== undefined ? [record.timeToFirstTokenMs] : [])), 95),
    },
    tokens: { total: tokens, averagePerCase: records.length ? tokens / records.length : 0 },
    cost: costed.length
      ? {
          estimate: true,
          total: costed.reduce((sum, record) => sum + (record.cost?.amount ?? 0), 0),
          averagePerCase: costed.reduce((sum, record) => sum + (record.cost?.amount ?? 0), 0) / costed.length,
          currency: costed[0]?.cost?.currency ?? 'USD',
        }
      : undefined,
    errors,
    worstCases,
  };
}

async function evaluateSafely(evaluator: Evaluator, context: Parameters<Evaluator['evaluate']>[0]): Promise<EvaluationResult> {
  try {
    return await evaluator.evaluate(context);
  } catch (error) {
    return {
      evaluatorId: evaluator.id,
      metric: evaluator.metric,
      value: 0,
      passed: false,
      security: evaluator.security,
      evidence: [`evaluator error: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

/** The eval runner (Section 107, 126, 223). */
export function createEvalRunner<TInput = unknown>(options: EvalRunnerOptions<TInput>): EvalRunner<TInput> {
  const evaluators = options.evaluators ?? defaultEvaluators();
  const repetitions = Math.max(1, options.repetitions ?? 1);
  const mode = options.telemetryMode ?? 'redacted';
  const now = options.now ?? ((): Date => new Date());

  async function runCase(dataset: EvalDataset<TInput>, evalCase: EvalCase<TInput>, repetition: number): Promise<CaseResult> {
    const telemetry = createRecordingTelemetry({ mode });
    const controller = new AbortController();
    const timer = options.caseTimeoutMs ? setTimeout(() => controller.abort(), options.caseTimeoutMs) : undefined;
    const started = performance.now();
    let target: TargetResult;
    try {
      target = await options.target(evalCase, { telemetry, signal: controller.signal, repetition });
    } catch (error) {
      const normalized = CopilotError.isCopilotError(error) ? error : CopilotError.internal(error instanceof Error ? error.message : String(error));
      target = { status: 'failed', error: normalized.toPublicJSON() };
    } finally {
      if (timer) clearTimeout(timer);
    }
    const latencyMs = Math.round(performance.now() - started);
    const record = buildExecutionRecord({
      session: projectSession(telemetry.session()),
      caseId: evalCase.id,
      repetition,
      target,
      latencyMs,
      costEstimator: options.costEstimator,
    });
    const context = { evalCase: evalCase as EvalCase, record, dataset: dataset as EvalDataset };
    const results: EvaluationResult[] = [];
    for (const evaluator of evaluators) {
      if (evaluator.applies && !evaluator.applies(evalCase)) continue;
      results.push(await evaluateSafely(evaluator, context));
    }
    const securityViolations = results.filter((entry) => entry.security === true && entry.passed === false);
    return {
      caseId: evalCase.id,
      repetition,
      adversarial: evalCase.adversarial === true,
      passed: results.every((entry) => entry.skipped || entry.passed !== false),
      record,
      results,
      securityViolations,
    };
  }

  return {
    async run(dataset, runOptions = {}) {
      const startedAt = now().toISOString();
      const cases = runOptions.tags ? dataset.cases.filter((evalCase) => evalCase.tags?.some((tag) => runOptions.tags?.includes(tag))) : dataset.cases;
      const results: CaseResult[] = [];
      for (const evalCase of cases) {
        for (let repetition = 1; repetition <= repetitions; repetition += 1) results.push(await runCase(dataset, evalCase, repetition));
      }
      return {
        id: options.id?.() ?? globalThis.crypto.randomUUID(),
        label: options.label,
        dataset: { id: dataset.id, version: dataset.version, caseCount: cases.length },
        snapshot: options.snapshot ?? {},
        telemetryMode: mode,
        startedAt,
        completedAt: now().toISOString(),
        results,
        summary: summarize(results, repetitions),
      };
    },
  };
}
