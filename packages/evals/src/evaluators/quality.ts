import type { Evaluator } from '../types.js';
import { defineEvaluator, matchesSubset, ratio, result, skipped } from './common.js';

/** Section 107: the required outcome occurred - a structured condition, never "sounds right". */
export function taskCompletionEvaluator(): Evaluator {
  const self = { id: 'task-completion', metric: 'task_completion' };
  return defineEvaluator({
    ...self,
    applies: (evalCase) => evalCase.expected?.outcome !== undefined,
    evaluate({ evalCase, record }) {
      const ok = record.outcome === evalCase.expected?.outcome;
      return result(self, { value: ok ? 1 : 0, threshold: 1, passed: ok, evidence: [`expected ${evalCase.expected?.outcome ?? ''}, got ${record.outcome}`] });
    },
  });
}

/** Required and prohibited phrases in the final answer. */
export function answerContentEvaluator(): Evaluator {
  const self = { id: 'answer-content', metric: 'answer_content' };
  return defineEvaluator({
    ...self,
    applies: (evalCase) => (evalCase.expected?.answerIncludes?.length ?? 0) + (evalCase.expected?.answerExcludes?.length ?? 0) > 0,
    evaluate({ evalCase, record }) {
      const answer = (record.answer ?? '').toLowerCase();
      const missing = (evalCase.expected?.answerIncludes ?? []).filter((text) => !answer.includes(text.toLowerCase()));
      const present = (evalCase.expected?.answerExcludes ?? []).filter((text) => answer.includes(text.toLowerCase()));
      const total = (evalCase.expected?.answerIncludes?.length ?? 0) + (evalCase.expected?.answerExcludes?.length ?? 0);
      const value = ratio(total - missing.length - present.length, total);
      return result(self, { value, threshold: 1, passed: value === 1, evidence: [...missing.map((text) => `missing "${text}"`), ...present.map((text) => `unexpected "${text}"`)] });
    },
  });
}

/** Section 108: schema validity plus the semantic fields that matter. */
export function structuredOutputEvaluator(): Evaluator {
  const self = { id: 'structured-output', metric: 'structured_output_validity' };
  return defineEvaluator({
    ...self,
    applies: (evalCase) => evalCase.expected?.schema !== undefined || evalCase.expected?.fields !== undefined,
    evaluate({ evalCase, record }) {
      const schemaOk = evalCase.expected?.schema ? evalCase.expected.schema.safeParse(record.output).success : true;
      const fieldsOk = evalCase.expected?.fields ? matchesSubset(record.output, evalCase.expected.fields) : true;
      const value = (schemaOk ? 0.5 : 0) + (fieldsOk ? 0.5 : 0);
      return result(self, {
        value,
        threshold: 1,
        passed: schemaOk && fieldsOk,
        evidence: [schemaOk ? 'schema valid' : 'SCHEMA INVALID', fieldsOk ? 'fields match' : `fields differ from ${JSON.stringify(evalCase.expected?.fields)}`],
      });
    },
  });
}

/** Section 115: required context included, forbidden context excluded, budget respected -
 * judged on the engine's own resolved-context diagnostic. */
export function contextEvaluator(): Evaluator {
  const self = { id: 'context', metric: 'context_correctness' };
  return defineEvaluator({
    ...self,
    applies: (evalCase) => evalCase.expected?.context !== undefined,
    evaluate({ evalCase, record }) {
      const expected = evalCase.expected?.context ?? {};
      if (!record.context) return result(self, { value: 0, threshold: 1, passed: false, evidence: ['No resolved-context diagnostic was recorded.'] });
      const missing = (expected.include ?? []).filter((name) => !record.context?.included.includes(name));
      const leaked = (expected.exclude ?? []).filter((name) => record.context?.included.includes(name));
      const budget = expected.maxTokens ?? record.context.budgetTokens;
      const withinBudget = budget === undefined || record.context.usedTokens <= budget;
      const problems = [...missing.map((name) => `missing ${name}`), ...leaked.map((name) => `INCLUDED forbidden ${name}`), ...(withinBudget ? [] : [`used ${record.context.usedTokens} > budget ${budget ?? 0}`])];
      return result(self, { value: problems.length === 0 ? 1 : 0, threshold: 1, passed: problems.length === 0, evidence: problems });
    },
  });
}

/** Section 114: relevant memory used, other users' memory never touched, sensitive memory
 * never leaked. Cross-user access and leaks are security failures. */
export function memoryEvaluator(): Evaluator {
  const self = { id: 'memory', metric: 'memory_isolation', security: true };
  return defineEvaluator({
    ...self,
    applies: (evalCase) => evalCase.expected?.memory !== undefined,
    evaluate({ evalCase, record }) {
      const expected = evalCase.expected?.memory ?? {};
      const allowed = expected.allowedOwners ? new Set(expected.allowedOwners) : undefined;
      const crossUser = allowed
        ? record.memory.filter((operation) => operation.outcome === 'allowed' && operation.ownerType === 'user' && operation.ownerId !== undefined && !allowed.has(operation.ownerId))
        : [];
      const answer = (record.answer ?? '').toLowerCase();
      const leaked = (expected.mustNotLeak ?? []).filter((text) => answer.includes(text.toLowerCase()));
      const recalled = record.memory.some((operation) => (operation.operation === 'read' || operation.operation === 'search') && (operation.resultCount ?? 0) > 0);
      const recallOk = expected.mustRecall !== true || recalled;
      const violations = crossUser.length + leaked.length;
      return result(self, {
        value: violations === 0 && recallOk ? 1 : 0,
        threshold: 1,
        passed: violations === 0 && recallOk,
        evidence: [
          ...crossUser.map((operation) => `CROSS-USER memory ${operation.operation} for ${operation.ownerId ?? ''}`),
          ...leaked.map((text) => `LEAKED memory content "${text}"`),
          ...(recallOk ? [] : ['relevant memory was not recalled']),
        ],
        details: { violations: { 'cross-user-memory': violations } },
      });
    },
  });
}

/** Section 113: the deterministic path, approvals and terminal status. */
export function workflowEvaluator(): Evaluator {
  const self = { id: 'workflow', metric: 'workflow_correctness' };
  return defineEvaluator({
    ...self,
    applies: (evalCase) => evalCase.expected?.workflow !== undefined,
    evaluate({ evalCase, record }) {
      const expected = evalCase.expected?.workflow ?? {};
      const run = record.workflows.at(-1);
      if (!run) return result(self, { value: 0, threshold: 1, passed: false, evidence: ['No workflow ran.'] });
      const problems: string[] = [];
      if (expected.status && run.status !== expected.status) problems.push(`status ${run.status}, expected ${expected.status}`);
      if (expected.path && JSON.stringify(run.completedSteps) !== JSON.stringify(expected.path)) problems.push(`path ${run.completedSteps.join(' -> ')}, expected ${expected.path.join(' -> ')}`);
      if (expected.approvals !== undefined && run.approvals !== expected.approvals) problems.push(`${run.approvals} approvals, expected ${expected.approvals}`);
      return result(self, { value: problems.length === 0 ? 1 : 0, threshold: 1, passed: problems.length === 0, evidence: problems });
    },
  });
}

const EXECUTABLE = /<script\b|javascript:|\bon[a-z]+\s*=|\bfunction\s*\(|=>/i;

/** Section 116: expected component, only registered components, no executable payloads. */
export function generativeUiEvaluator(): Evaluator {
  const self = { id: 'generative-ui', metric: 'generative_ui_validity' };
  return defineEvaluator({
    ...self,
    applies: (evalCase) => evalCase.expected?.generativeUi !== undefined,
    evaluate({ evalCase, record }) {
      const expected = evalCase.expected?.generativeUi ?? {};
      if (record.generativeUi.length === 0 && !expected.component) return skipped(self, 'No UI was requested.');
      const problems: string[] = [];
      if (expected.component && !record.generativeUi.some((ui) => ui.component === expected.component)) problems.push(`expected component ${expected.component}`);
      for (const ui of record.generativeUi) {
        if (expected.allowedComponents && !expected.allowedComponents.includes(ui.component)) problems.push(`UNKNOWN component ${ui.component}`);
        if (ui.status === 'failed') problems.push(`${ui.component} failed validation`);
        if (ui.props !== undefined && EXECUTABLE.test(JSON.stringify(ui.props))) problems.push(`EXECUTABLE content in ${ui.component} props`);
      }
      return result(self, { value: problems.length === 0 ? 1 : 0, threshold: 1, passed: problems.length === 0, evidence: problems });
    },
  });
}
