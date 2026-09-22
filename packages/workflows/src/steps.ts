import type { AgentStep, ApprovalStep, ConditionStep, FunctionStep, ParallelStep, ToolStep } from './definition.js';

/**
 * Ergonomic, typed step constructors (Section 84, 165) - thin identity functions over the
 * `WorkflowStep` union's own literals, so a workflow definition reads as
 * `steps: [functionStep(...), toolStep(...), approvalStep(...)]` rather than repeating
 * `type: '...'` at every call site. Each one is exactly the shape `definition.ts` already
 * declares; no behavior lives here.
 */
export function functionStep<TState = unknown>(step: Omit<FunctionStep<TState>, 'type'>): FunctionStep<TState> {
  return { type: 'function', ...step };
}

export function toolStep<TState = unknown>(step: Omit<ToolStep<TState>, 'type'>): ToolStep<TState> {
  return { type: 'tool', ...step };
}

export function agentStep<TState = unknown>(step: Omit<AgentStep<TState>, 'type'>): AgentStep<TState> {
  return { type: 'agent', ...step };
}

export function approvalStep<TState = unknown>(step: Omit<ApprovalStep<TState>, 'type'>): ApprovalStep<TState> {
  return { type: 'approval', ...step };
}

export function conditionStep<TState = unknown>(step: Omit<ConditionStep<TState>, 'type'>): ConditionStep<TState> {
  return { type: 'condition', ...step };
}

export function parallelStep<TState = unknown>(step: Omit<ParallelStep<TState>, 'type'>): ParallelStep<TState> {
  return { type: 'parallel', ...step };
}
