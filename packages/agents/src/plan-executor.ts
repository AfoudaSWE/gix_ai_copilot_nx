import { CopilotError } from '@gixcopilot/protocol';
import type { PublicCopilotError, RunId, ThreadId, ToolResult } from '@gixcopilot/protocol';
import type { ToolRuntime } from '@gixcopilot/tools';
import type { SecurityContext } from '@gixcopilot/security';
import { validatePlanStructure } from './plan.js';
import type { Plan, PlanStep } from './plan.js';
import type { AgentRuntime } from './runtime.js';
import type { AgentEventListener } from './events.js';

export interface PlanStepResult {
  readonly stepId: string;
  readonly status: 'completed' | 'failed' | 'skipped';
  readonly output?: unknown;
  readonly error?: PublicCopilotError;
}

export interface PlanExecutionResult {
  readonly planId: string;
  readonly status: 'completed' | 'failed';
  readonly steps: readonly PlanStepResult[];
}

export interface ExecutePlanOptions {
  readonly runId: RunId;
  readonly threadId: ThreadId;
  readonly securityContext: SecurityContext;
  readonly signal?: AbortSignal;
  readonly onEvent?: AgentEventListener;
  /** Required only if the plan has any `type: 'tool'` step - every real tool call still goes
   * through this exact runtime, so the Action Firewall (if wired into it) still gates
   * execution regardless of what the plan requested (Section 78, 191). */
  readonly toolRuntime?: ToolRuntime;
  /** Required only if the plan has any `type: 'agent'` step. */
  readonly agentRuntime?: AgentRuntime;
}

function topologicalOrder(plan: Plan): readonly PlanStep[] {
  const byId = new Map(plan.steps.map((step) => [step.id, step]));
  const visited = new Set<string>();
  const ordered: PlanStep[] = [];

  function visit(step: PlanStep): void {
    if (visited.has(step.id)) return;
    visited.add(step.id);
    for (const dependencyId of step.dependencies ?? []) {
      const dependency = byId.get(dependencyId);
      if (dependency) visit(dependency);
    }
    ordered.push(step);
  }

  for (const step of plan.steps) visit(step);
  return ordered;
}

/**
 * Sequential plan execution (Section 79) in dependency order. A step whose dependency failed
 * is skipped, never silently run against a missing prerequisite (Section 156's "a child
 * failure must not silently disappear"). `'knowledge'`/`'model'` steps describe intent only -
 * this package has no RAG/model-generation dependency of its own (Section 36's "actual
 * retrieval stays with `@gixcopilot/rag`") - a caller that needs them to do real work supplies
 * its own handling at the composition layer; here they are recorded as completed no-ops.
 */
export async function executePlan(plan: Plan, options: ExecutePlanOptions): Promise<PlanExecutionResult> {
  const structuralErrors = validatePlanStructure(plan);
  if (structuralErrors.length > 0) {
    throw CopilotError.agentPlanInvalid('Cannot execute an invalid plan.', {
      planId: plan.id,
      errors: structuralErrors.map((error) => error.message),
    });
  }

  const ordered = topologicalOrder(plan);
  const results = new Map<string, PlanStepResult>();
  let failed = false;

  for (const step of ordered) {
    const dependencyFailed = (step.dependencies ?? []).some(
      (dependencyId) => results.get(dependencyId)?.status !== 'completed',
    );
    if (dependencyFailed) {
      results.set(step.id, { stepId: step.id, status: 'skipped' });
      continue;
    }

    try {
      const output = await executeStep(step, options);
      results.set(step.id, { stepId: step.id, status: 'completed', output });
    } catch (error) {
      failed = true;
      const copilotError = CopilotError.isCopilotError(error)
        ? error
        : CopilotError.agentPlanStepFailed(error instanceof Error ? error.message : String(error), {
            stepId: step.id,
          });
      results.set(step.id, { stepId: step.id, status: 'failed', error: copilotError.toPublicJSON() });
    }
  }

  return {
    planId: plan.id,
    status: failed ? 'failed' : 'completed',
    steps: plan.steps.map((step) => results.get(step.id) ?? { stepId: step.id, status: 'skipped' }),
  };
}

async function executeStep(step: PlanStep, options: ExecutePlanOptions): Promise<unknown> {
  switch (step.type) {
    case 'tool': {
      if (!options.toolRuntime) {
        throw CopilotError.agentPlanStepFailed('No ToolRuntime was provided to execute a tool step.', {
          stepId: step.id,
        });
      }
      const toolCallId = planStepToolCallId(step.id);
      const result: ToolResult = await options.toolRuntime.execute({
        toolCallId,
        name: step.target ?? '',
        arguments: step.input,
        context: {
          runId: options.runId,
          threadId: options.threadId,
          signal: options.signal ?? new AbortController().signal,
          metadata: { securityContext: options.securityContext },
        },
      });
      if (result.status === 'error') {
        throw new CopilotError(result.error.code, result.error.message, {
          retryable: result.error.retryable,
          metadata: result.error.metadata,
        });
      }
      return result.data;
    }
    case 'agent': {
      if (!options.agentRuntime) {
        throw CopilotError.agentPlanStepFailed('No AgentRuntime was provided to execute an agent step.', {
          stepId: step.id,
        });
      }
      const result = await options.agentRuntime.run({
        agent: step.target ?? '',
        input: step.input ?? {},
        securityContext: options.securityContext,
        threadId: options.threadId,
        signal: options.signal,
        onEvent: options.onEvent,
      });
      if (result.status !== 'completed') {
        throw new CopilotError(
          result.error?.code ?? 'AGENT_EXECUTION_ERROR',
          result.error?.message ?? `Agent step "${step.id}" did not complete.`,
        );
      }
      return result.output;
    }
    case 'knowledge':
    case 'model':
      return { note: `Step "${step.id}" of type "${step.type}" is descriptive only in this runtime.` };
    default: {
      const exhaustive: never = step.type;
      throw new Error(`Unhandled plan step type: ${String(exhaustive)}`);
    }
  }
}

function planStepToolCallId(stepId: string): string {
  return `plan-${stepId}-${Date.now().toString(36)}`;
}
