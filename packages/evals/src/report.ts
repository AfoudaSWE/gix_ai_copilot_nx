import type { EvalComparison } from './compare.js';
import type { GateResult } from './gates.js';
import type { EvalRun, MetricSummary } from './types.js';

function format(summary: MetricSummary): string {
  switch (summary.unit) {
    case 'ms':
      return `${Math.round(summary.mean)} ms (mean)`;
    case 'tokens':
      return `${Math.round(summary.mean)} tokens (mean)`;
    case 'currency':
      return `${summary.mean.toFixed(6)} (mean, estimate)`;
    case 'count':
      return `${summary.mean.toFixed(2)} (mean)`;
    case 'ratio':
      return `${(summary.mean * 100).toFixed(1)}%${summary.passRate !== undefined ? ` - ${(summary.passRate * 100).toFixed(1)}% of cases pass` : ''}`;
  }
}

const TITLES: Record<string, string> = {
  'task-completion': 'Task Completion',
  'answer-content': 'Answer Content',
  'forbidden-agents': 'Forbidden Agents',
  'structured-output': 'Structured Output',
  context: 'Context',
  planner: 'Planner',
  'generative-ui': 'Generative UI',
  'tool-selection': 'Tool Selection',
  'tool-arguments': 'Tool Arguments',
  'forbidden-tools': 'Forbidden Tool Violations',
  'permission-compliance': 'Permission Compliance',
  groundedness: 'Groundedness',
  citations: 'Citation Validity',
  retrieval: 'Retrieval (Recall@K)',
  'acl-retrieval': 'Restricted Knowledge',
  'agent-routing': 'Agent Routing',
  delegation: 'Delegation',
  handoff: 'Handoff',
  memory: 'Memory Isolation',
  workflow: 'Workflow',
  latency: 'Latency',
  tokens: 'Tokens',
  cost: 'Estimated Cost',
  'error-rate': 'Error-free Runs',
};

/**
 * Developer-readable report (Section 128, 205). Every number comes from the run itself -
 * nothing here is invented, and heuristic metrics and cost estimates are labeled as such.
 */
export function renderEvalReport(run: EvalRun, options: { readonly comparison?: EvalComparison; readonly gate?: GateResult } = {}): string {
  const { summary } = run;
  const lines: string[] = [
    'AI Copilot Evaluation',
    '',
    `Dataset:   ${run.dataset.id}@${run.dataset.version}`,
    `Run:       ${run.id}${run.label ? ` (${run.label})` : ''}`,
    `Model:     ${[run.snapshot.model?.provider, run.snapshot.model?.model].filter(Boolean).join('/') || 'not recorded'}`,
    `Cases:     ${summary.cases}${summary.repetitions > 1 ? ` x ${summary.repetitions} repetitions` : ''}`,
    `Passed:    ${summary.passed} / ${summary.cases}`,
    `Failed:    ${summary.failed}`,
    '',
    'Metrics',
  ];
  for (const metric of summary.metrics) {
    const flags = [metric.security ? 'SECURITY' : '', metric.heuristic ? 'heuristic' : '', metric.meanStdDev !== undefined ? `stddev ${metric.meanStdDev.toFixed(3)}` : ''].filter(Boolean).join(', ');
    lines.push(`  ${(TITLES[metric.evaluatorId] ?? metric.metric).padEnd(28)} ${format(metric)}${flags ? `  [${flags}]` : ''}`);
  }
  lines.push(
    '',
    'Security',
    `  Unauthorized actions:        ${summary.security.unauthorizedActions}`,
    `  Forbidden tool violations:   ${summary.security.forbiddenToolViolations}`,
    `  Approval bypasses:           ${summary.security.approvalBypasses}`,
    `  Restricted knowledge leaks:  ${summary.security.restrictedKnowledgeLeaks}`,
    `  Cross-user memory leaks:     ${summary.security.crossUserMemoryLeaks}`,
    `  SECURITY GATE:               ${summary.security.gate}`,
    '',
    'Performance',
    `  P50 latency:  ${summary.latency.p50 ?? 'n/a'} ms`,
    `  P95 latency:  ${summary.latency.p95 ?? 'n/a'} ms`,
    `  Avg tokens:   ${Math.round(summary.tokens.averagePerCase)}`,
    `  Est. cost:    ${summary.cost ? `${summary.cost.averagePerCase.toFixed(6)} ${summary.cost.currency} per case (estimate from configured pricing)` : 'no pricing configured'}`,
  );
  if (summary.worstCases.length > 0) {
    lines.push('', 'Worst cases');
    for (const worst of summary.worstCases) lines.push(`  ${worst.caseId}  score ${worst.score.toFixed(2)}  failed: ${worst.failedMetrics.join(', ')}`);
  }
  const failures = run.results.filter((result) => !result.passed);
  if (failures.length > 0) {
    lines.push('', 'Failures');
    for (const failure of failures) {
      lines.push(`  ${failure.caseId}${failure.repetition > 1 ? ` #${failure.repetition}` : ''}  (runs: ${failure.record.runIds.join(', ') || 'none'})`);
      for (const evaluation of failure.results.filter((entry) => entry.passed === false)) {
        lines.push(`    - ${evaluation.metric}: ${evaluation.evidence.slice(0, 3).join('; ')}`);
      }
    }
  }
  if (options.comparison) {
    lines.push('', `Regression vs baseline ${options.comparison.baselineRunId}: ${options.comparison.regressions.length === 0 ? 'NONE' : `${options.comparison.regressions.length} found`}`);
    if (!options.comparison.comparable) lines.push(`  WARNING: ${options.comparison.warnings.join(' ')}`);
    for (const regression of options.comparison.regressions) lines.push(`  - ${regression}`);
  }
  if (options.gate) {
    lines.push('', `CI GATE: ${options.gate.passed ? 'PASS' : 'FAIL'}`);
    for (const failure of options.gate.failures) lines.push(`  - ${failure}`);
  }
  return lines.join('\n');
}

/** Machine-readable output for CI (Section 129). Records are included for failure triage. */
export function toEvalJson(run: EvalRun, options: { readonly comparison?: EvalComparison; readonly gate?: GateResult } = {}): string {
  return JSON.stringify({ format: 'gixcopilot.eval.run', version: 1, run, comparison: options.comparison, gate: options.gate }, null, 2);
}
