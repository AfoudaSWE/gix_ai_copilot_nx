import { CopilotError } from '@gixcopilot/protocol';
import { generateObject } from '@gixcopilot/provider';
import type { ModelReference, ModelRuntime } from '@gixcopilot/provider';
import { planSchema, validatePlanStructure } from './plan.js';
import type { Plan } from './plan.js';

export interface CreatePlannerOptions {
  readonly modelRuntime: ModelRuntime;
  readonly model?: ModelReference;
  readonly instructions?: string;
  readonly signal?: AbortSignal;
}

export interface Planner {
  plan(goal: string, availableToolNames: readonly string[], availableAgentIds: readonly string[]): Promise<Plan>;
}

const DEFAULT_PLANNER_INSTRUCTIONS =
  'Produce a structured plan to achieve the goal. Each step is one of "tool", "agent", ' +
  '"knowledge", or "model". A "tool"/"agent" step must set "target" to an exact name/id from ' +
  'the provided lists - never invent one. "dependencies" lists sibling step ids that must ' +
  'complete first. Respond with a single JSON object matching the plan schema only.';

/**
 * Planner/executor separation (Section 74-81): the planner only ever produces a structured,
 * schema-validated `Plan` - it never executes anything itself (see plan-executor.ts) and its
 * output is never treated as authorization (Section 78) - only the real tool/agent runtimes,
 * gated by the Action Firewall, decide whether a step is actually allowed to run.
 */
export function createPlanner(options: CreatePlannerOptions): Planner {
  return {
    async plan(goal, availableToolNames, availableAgentIds) {
      const result = await generateObject({
        runtime: options.modelRuntime,
        model: options.model,
        schema: planSchema,
        signal: options.signal,
        messages: [
          {
            role: 'system',
            content: [
              {
                type: 'text',
                text:
                  `${options.instructions ?? DEFAULT_PLANNER_INSTRUCTIONS}\n\n` +
                  `Available tools: ${availableToolNames.join(', ') || '(none)'}\n` +
                  `Available agents: ${availableAgentIds.join(', ') || '(none)'}`,
              },
            ],
          },
          { role: 'user', content: [{ type: 'text', text: goal }] },
        ],
      });

      const plan = result.object;
      const structuralErrors = validatePlanStructure(plan);
      const referenceErrors = plan.steps
        .filter((step) => step.type === 'tool' && step.target && !availableToolNames.includes(step.target))
        .map((step) => `Step "${step.id}" targets unknown tool "${step.target ?? ''}".`)
        .concat(
          plan.steps
            .filter((step) => step.type === 'agent' && step.target && !availableAgentIds.includes(step.target))
            .map((step) => `Step "${step.id}" targets unknown agent "${step.target ?? ''}".`),
        );

      if (structuralErrors.length > 0 || referenceErrors.length > 0) {
        throw CopilotError.agentPlanInvalid('The generated plan failed validation.', {
          goal,
          structuralErrors: structuralErrors.map((error) => error.message),
          referenceErrors,
        });
      }

      return plan;
    },
  };
}
