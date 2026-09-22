import type { ToolStep, WorkflowStep } from './definition.js';
import type { WorkflowStepRecord } from './state.js';

/**
 * Compensation is a new action that semantically reverses a previous one - never a real
 * distributed rollback (Section 119-120). Only `ToolStep`s can declare `compensate`; other
 * step types have no reverse-action concept in this runtime.
 */
export function isCompensatableStep(step: WorkflowStep): step is ToolStep {
  return step.type === 'tool' && step.compensate !== undefined;
}

/**
 * Given the steps that actually completed (in forward order) up to and including a failure,
 * returns the reverse-order list of compensatable steps to run (Section 119, 202). Best
 * effort: one compensation failing does not remove the rest from this plan - the caller
 * decides whether to keep going (Section 120's "not a distributed transaction").
 */
export function buildCompensationPlan(
  steps: readonly WorkflowStep[],
  completedRecords: readonly WorkflowStepRecord[],
): readonly ToolStep[] {
  const completedIds = new Set(
    completedRecords.filter((record) => record.status === 'completed').map((record) => record.stepId),
  );
  const byId = new Map(steps.map((step) => [step.id, step]));
  const plan: ToolStep[] = [];
  for (const record of completedRecords) {
    if (!completedIds.has(record.stepId)) continue;
    const step = byId.get(record.stepId);
    if (step && isCompensatableStep(step)) plan.push(step);
  }
  return plan.reverse();
}
