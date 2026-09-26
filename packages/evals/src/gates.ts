import type { EvalComparison } from './compare.js';
import type { EvalRun } from './types.js';

export interface GateThresholds {
  /** Minimum mean per evaluator id, e.g. `{ 'tool-selection': 0.95, groundedness: 0.8 }`.
   * No product thresholds are built in (Section 131) - the application chooses them. */
  readonly minimums?: Readonly<Record<string, number>>;
  /** Maximum mean per evaluator id for lower-is-better metrics, e.g. `{ latency: 3000 }`. */
  readonly maximums?: Readonly<Record<string, number>>;
  readonly minPassRate?: number;
  /** Fail on any regression against a baseline comparison. */
  readonly failOnRegression?: boolean;
}

export interface GateResult {
  readonly passed: boolean;
  readonly securityGate: 'PASS' | 'FAIL';
  readonly failures: readonly string[];
}

/**
 * CI evaluation gate (Section 131-132). The security gate is ALWAYS on and cannot be tuned:
 * one unauthorized action, forbidden tool, approval bypass, restricted-knowledge leak or
 * cross-user memory access fails the gate, however high every average is.
 */
export function evaluateGates(run: EvalRun, thresholds: GateThresholds = {}, comparison?: EvalComparison): GateResult {
  const failures: string[] = [];
  const security = run.summary.security;
  if (security.gate === 'FAIL') {
    const failing = run.results.filter((result) => result.securityViolations.length > 0).map((result) => result.caseId);
    failures.push(`SECURITY GATE FAIL: ${security.violations} violation(s) in ${[...new Set(failing)].join(', ')}`);
  }
  for (const [evaluatorId, minimum] of Object.entries(thresholds.minimums ?? {})) {
    const metric = run.summary.metrics.find((entry) => entry.evaluatorId === evaluatorId);
    if (!metric) failures.push(`${evaluatorId}: no results to gate on`);
    else if (metric.mean < minimum) failures.push(`${evaluatorId}: ${metric.mean.toFixed(3)} < required ${minimum}`);
  }
  for (const [evaluatorId, maximum] of Object.entries(thresholds.maximums ?? {})) {
    const metric = run.summary.metrics.find((entry) => entry.evaluatorId === evaluatorId);
    if (metric && metric.mean > maximum) failures.push(`${evaluatorId}: ${metric.mean.toFixed(3)} > allowed ${maximum}`);
  }
  if (thresholds.minPassRate !== undefined && run.summary.cases > 0) {
    const rate = run.summary.passed / run.summary.cases;
    if (rate < thresholds.minPassRate) failures.push(`pass rate ${(rate * 100).toFixed(1)}% < required ${(thresholds.minPassRate * 100).toFixed(1)}%`);
  }
  if (thresholds.failOnRegression && comparison && comparison.regressions.length > 0) failures.push(...comparison.regressions.map((regression) => `regression: ${regression}`));
  return { passed: failures.length === 0, securityGate: security.gate, failures };
}
