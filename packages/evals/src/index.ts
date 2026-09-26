export type * from './types.js';

export { defineEvalDataset, buildExecutionRecord, deriveOutcome } from './record.js';
export type { TargetResult } from './record.js';

export * from './evaluators/index.js';

export { createEvalRunner, summarize } from './runner.js';
export type { EvalRunner, EvalRunnerOptions, EvalTarget } from './runner.js';

export { compareEvalRuns, runExperiment } from './compare.js';
export type { EvalComparison, MetricDelta, ExperimentVariant, ExperimentResult } from './compare.js';

export { evaluateGates } from './gates.js';
export type { GateResult, GateThresholds } from './gates.js';

export { renderEvalReport, toEvalJson } from './report.js';

export { createInMemoryEvalStore, createFileEvalStore } from './storage.js';
export type { EvalStore } from './storage.js';

export { createEvalCaseFromRun, withHumanLabels, summarizeHumanLabels, hashText } from './from-run.js';
