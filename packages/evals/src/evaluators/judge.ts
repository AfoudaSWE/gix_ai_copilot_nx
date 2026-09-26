import type { EvalCase, Evaluator, ExecutionRecord } from '../types.js';
import { defineEvaluator, result, skipped } from './common.js';

export interface JudgeVerdict {
  /** 0..1. */
  readonly score: number;
  readonly rationale?: string;
}

/**
 * The judge is any function - typically `generateObject` over the SAME provider runtime the
 * application uses (Section 226: the eval core never constructs a provider client itself).
 */
export type JudgeFunction = (input: {
  readonly question: unknown;
  readonly answer: string;
  readonly evidence: readonly string[];
  readonly rubric: string;
}) => Promise<JudgeVerdict>;

/**
 * Optional LLM-as-judge (Section 135). Structured verdicts only; the judge model and prompt
 * version are recorded on every result; results are marked heuristic; and a judge can never
 * be a security evaluator - security is decided by recorded runtime facts, not opinions.
 */
export function createLlmJudgeEvaluator(options: {
  readonly id?: string;
  readonly metric?: string;
  readonly judge: JudgeFunction;
  readonly judgeModel: string;
  readonly promptVersion: string;
  readonly rubric: string;
  readonly threshold?: number;
  readonly applies?: (evalCase: EvalCase) => boolean;
}): Evaluator {
  const self = { id: options.id ?? 'llm-judge', metric: options.metric ?? 'judged_quality', heuristic: true };
  const threshold = options.threshold ?? 0.7;
  const evidenceOf = (record: ExecutionRecord): string[] => [
    ...record.retrievedSources.flatMap((source) => (source.excerpt ? [source.excerpt] : [])),
    ...record.tools.filter((tool) => tool.executed && tool.result !== undefined).map((tool) => JSON.stringify(tool.result)),
  ];
  return defineEvaluator({
    ...self,
    applies: options.applies,
    async evaluate({ evalCase, record }) {
      if (!record.answer) return skipped(self, 'No answer to judge.');
      const verdict = await options.judge({ question: evalCase.input, answer: record.answer, evidence: evidenceOf(record), rubric: options.rubric });
      const score = Math.min(1, Math.max(0, verdict.score));
      return result(self, {
        value: score,
        threshold,
        passed: score >= threshold,
        evidence: [`judge ${options.judgeModel} (prompt ${options.promptVersion}): ${verdict.rationale ?? 'no rationale'}`],
        details: { judgeModel: options.judgeModel, promptVersion: options.promptVersion, heuristic: true },
      });
    },
  });
}
