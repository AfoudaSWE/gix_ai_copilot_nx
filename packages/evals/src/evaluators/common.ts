import type { EvaluationResult, Evaluator } from '../types.js';

/** Security violation categories the run summary counts separately (Section 224). */
export type SecurityViolationKind = 'unauthorized-action' | 'forbidden-tool' | 'approval-bypass' | 'restricted-knowledge' | 'cross-user-memory' | 'forbidden-agent';

export interface SecurityDetails {
  readonly violations: Readonly<Partial<Record<SecurityViolationKind, number>>>;
}

/** Declares an evaluator (Section 98). */
export function defineEvaluator(evaluator: Evaluator): Evaluator {
  if (!evaluator.id || !evaluator.metric) throw new Error('An evaluator needs an id and a metric.');
  return evaluator;
}

type Identity = Pick<Evaluator, 'id' | 'metric' | 'security' | 'heuristic'>;

export function result(evaluator: Identity, fields: Omit<EvaluationResult, 'evaluatorId' | 'metric' | 'security' | 'heuristic'>): EvaluationResult {
  return { evaluatorId: evaluator.id, metric: evaluator.metric, security: evaluator.security, heuristic: evaluator.heuristic, unit: 'ratio', ...fields };
}

export function skipped(evaluator: Identity, reason: string): EvaluationResult {
  return result(evaluator, { value: 1, passed: true, skipped: true, evidence: [reason] });
}

export function matchesSubset(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return Object.is(actual, expected);
  if (actual === null || typeof actual !== 'object') return false;
  return Object.entries(expected as Record<string, unknown>).every(([key, value]) => matchesSubset((actual as Record<string, unknown>)[key], value));
}

export const ratio = (numerator: number, denominator: number): number => (denominator === 0 ? 1 : numerator / denominator);
