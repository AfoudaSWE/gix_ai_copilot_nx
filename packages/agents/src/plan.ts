import { z } from 'zod';

/**
 * A structured, schema-validated plan (Section 75-77) - data the planner produces, never
 * executable code (Section 76's explicit prohibition). `dependencies` names sibling step ids
 * that must complete first; the plan executor (plan-executor.ts) validates this forms a DAG
 * before running anything.
 */
export const planStepSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['tool', 'agent', 'knowledge', 'model']),
  description: z.string().min(1),
  /** The tool name (`type: 'tool'`) or agent id (`type: 'agent'`) this step invokes. Absent
   * for `'knowledge'`/`'model'` steps, which describe intent only - see plan-executor.ts. */
  target: z.string().min(1).optional(),
  input: z.unknown().optional(),
  dependencies: z.array(z.string().min(1)).optional(),
});

export type PlanStep = z.infer<typeof planStepSchema>;

export const planSchema = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  steps: z.array(planStepSchema).min(1),
});

export type Plan = z.infer<typeof planSchema>;

export interface PlanValidationError {
  readonly reason:
    | 'DUPLICATE_STEP_ID'
    | 'UNKNOWN_DEPENDENCY'
    | 'CYCLE_DETECTED'
    | 'MISSING_TARGET';
  readonly stepId?: string;
  readonly message: string;
}

/**
 * Structural validation only (Section 77): unique step ids, dependencies referencing real
 * sibling steps, no cycles, and a `target` present wherever the step type requires one. This
 * never checks whether the *caller* is authorized to run a step - that is the Action
 * Firewall's job at actual dispatch time (Section 78, 191), not the plan validator's.
 */
export function validatePlanStructure(plan: Plan): readonly PlanValidationError[] {
  const errors: PlanValidationError[] = [];
  const seen = new Set<string>();
  for (const step of plan.steps) {
    if (seen.has(step.id)) {
      errors.push({
        reason: 'DUPLICATE_STEP_ID',
        stepId: step.id,
        message: `Duplicate plan step id "${step.id}".`,
      });
    }
    seen.add(step.id);
    if ((step.type === 'tool' || step.type === 'agent') && !step.target) {
      errors.push({
        reason: 'MISSING_TARGET',
        stepId: step.id,
        message: `Step "${step.id}" of type "${step.type}" must declare a target.`,
      });
    }
  }

  const byId = new Map(plan.steps.map((step) => [step.id, step]));
  for (const step of plan.steps) {
    for (const dependency of step.dependencies ?? []) {
      if (!byId.has(dependency)) {
        errors.push({
          reason: 'UNKNOWN_DEPENDENCY',
          stepId: step.id,
          message: `Step "${step.id}" depends on unknown step "${dependency}".`,
        });
      }
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(plan.steps.map((step) => [step.id, WHITE]));
  let cycleFound = false;

  function visit(stepId: string): void {
    if (cycleFound || color.get(stepId) === BLACK) return;
    if (color.get(stepId) === GRAY) {
      cycleFound = true;
      return;
    }
    color.set(stepId, GRAY);
    const step = byId.get(stepId);
    for (const dependency of step?.dependencies ?? []) {
      if (byId.has(dependency)) visit(dependency);
    }
    color.set(stepId, BLACK);
  }

  for (const step of plan.steps) visit(step.id);
  if (cycleFound) {
    errors.push({ reason: 'CYCLE_DETECTED', message: 'The plan contains a dependency cycle.' });
  }

  return errors;
}
