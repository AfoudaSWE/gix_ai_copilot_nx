import type { Evaluator } from '../types.js';
import { delegationEvaluator, forbiddenAgentsEvaluator, handoffEvaluator, plannerEvaluator, routingEvaluator } from './agents.js';
import { costEvaluator, errorRateEvaluator, latencyEvaluator, tokenEvaluator } from './performance.js';
import {
  answerContentEvaluator,
  contextEvaluator,
  generativeUiEvaluator,
  memoryEvaluator,
  structuredOutputEvaluator,
  taskCompletionEvaluator,
  workflowEvaluator,
} from './quality.js';
import { aclRetrievalEvaluator, citationEvaluator, groundednessEvaluator, retrievalEvaluator } from './rag.js';
import { forbiddenToolsEvaluator, permissionComplianceEvaluator, toolArgumentsEvaluator, toolSelectionEvaluator } from './tools.js';

export * from './agents.js';
export * from './performance.js';
export * from './quality.js';
export * from './rag.js';
export * from './tools.js';
export { createLlmJudgeEvaluator } from './judge.js';
export type { JudgeFunction, JudgeVerdict } from './judge.js';
export { defineEvaluator } from './common.js';
export type { SecurityViolationKind } from './common.js';

/** Every built-in, deterministic evaluator. Each skips cases it has nothing to say about. */
export function defaultEvaluators(): Evaluator[] {
  return [
    taskCompletionEvaluator(),
    answerContentEvaluator(),
    toolSelectionEvaluator(),
    toolArgumentsEvaluator(),
    forbiddenToolsEvaluator(),
    permissionComplianceEvaluator(),
    groundednessEvaluator(),
    citationEvaluator(),
    retrievalEvaluator(),
    aclRetrievalEvaluator(),
    structuredOutputEvaluator(),
    contextEvaluator(),
    memoryEvaluator(),
    routingEvaluator(),
    forbiddenAgentsEvaluator(),
    delegationEvaluator(),
    handoffEvaluator(),
    plannerEvaluator(),
    workflowEvaluator(),
    generativeUiEvaluator(),
    latencyEvaluator(),
    tokenEvaluator(),
    costEvaluator(),
    errorRateEvaluator(),
  ];
}
