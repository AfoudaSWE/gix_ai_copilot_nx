import type { z } from 'zod';
import { CopilotError } from '@gixcopilot/protocol';
import type { ToolActionRisk, ToolActionReversibility, ToolApprovalLevel } from '@gixcopilot/protocol';
import type { SecurityContext } from '@gixcopilot/security';

/** What a step sees while running (Section 97). `state` is always the latest, already-
 * validated (if `stateSchema` is declared) state - never a stale snapshot. */
export interface WorkflowStepContext<TState = unknown> {
  readonly state: TState;
  readonly workflowRunId: string;
  readonly securityContext: SecurityContext;
  readonly signal: AbortSignal;
}

interface WorkflowStepBase<TState = unknown> {
  readonly id: string;
  /** Sibling step ids that must complete before this one is eligible to run (Section 88,
   * 163-164: the DAG). Omit for "runs as soon as the engine reaches it in declaration order." */
  readonly dependencies?: readonly string[];
  /** Optional gate (Section 93's typed-condition requirement, generalized to every step
   * type): when it returns `false`, the step is marked `'skipped'` rather than run - this is
   * how a `ConditionStep`'s boolean result, written into `state`, drives branching without a
   * second "branch to step id" graph. Always developer-authored code, never a string the
   * model or a plan could inject (Section 93-94). */
  runIf?(context: WorkflowStepContext<TState>): boolean;
}

/** The only step type that runs arbitrary developer TypeScript (Section 89) - never model-
 * or plan-supplied. `run`'s return value becomes the workflow's new state directly. */
export interface FunctionStep<TState = unknown> extends WorkflowStepBase<TState> {
  readonly type: 'function';
  run(context: WorkflowStepContext<TState>): Promise<TState> | TState;
}

/** Dispatches through the real `@gixcopilot/tools` `ToolRuntime` - never bypasses Phase 5/7
 * (Section 90). `compensate`, when declared, is the developer-specified reverse action
 * (Section 119-121) run in reverse order if a LATER step in the same workflow run fails. */
export interface ToolStep<TState = unknown> extends WorkflowStepBase<TState> {
  readonly type: 'tool';
  readonly tool: string;
  input(context: WorkflowStepContext<TState>): unknown;
  updateState(state: TState, output: unknown): TState;
  readonly compensate?: {
    readonly tool: string;
    input(context: WorkflowStepContext<TState>): unknown;
  };
}

/** Dispatches through `@gixcopilot/agents`' `AgentRuntime` as a controlled step (Section 91). */
export interface AgentStep<TState = unknown> extends WorkflowStepBase<TState> {
  readonly type: 'agent';
  readonly agent: string;
  input(context: WorkflowStepContext<TState>): unknown;
  updateState(state: TState, output: unknown): TState;
}

/**
 * Bridges into the real Phase 7 HITL pipeline (Section 92, 125-126) - the engine synthesizes
 * a reserved tool call (`workflow.approval.<stepId>`) dispatched through the SAME
 * `ToolRuntime`/`ActionFirewall`/`ApprovalStore` every other approval uses, so
 * `approval.requested/approved/rejected/expired` fire unchanged and no second approval engine
 * exists. `summary`/`risk`/`reversibility`/`approval` mirror `ToolSecurityManifest` exactly.
 */
export interface ApprovalStep<TState = unknown> extends WorkflowStepBase<TState> {
  readonly type: 'approval';
  readonly action: string;
  summary(context: WorkflowStepContext<TState>): string;
  readonly requiredPermissions?: readonly string[];
  readonly risk?: ToolActionRisk;
  readonly reversibility?: ToolActionReversibility;
  readonly approval?: ToolApprovalLevel;
}

/** A typed, developer-authored predicate (Section 93) - never an arbitrary JavaScript
 * string. Its boolean result is written into `state` via `updateState` for later steps'
 * `runIf` to read, which is how conditional branching composes without a second graph. */
export interface ConditionStep<TState = unknown> extends WorkflowStepBase<TState> {
  readonly type: 'condition';
  evaluate(context: WorkflowStepContext<TState>): boolean;
  updateState(state: TState, result: boolean): TState;
}

/** Runs `branches` (sibling step ids, already declared in the same `steps` array) concurrently
 * (Section 95-96). Branch steps are excluded from the main sequential/DAG order - they run
 * only as this step's own body. */
export interface ParallelStep<TState = unknown> extends WorkflowStepBase<TState> {
  readonly type: 'parallel';
  readonly branches: readonly string[];
  /** `'fail-fast'` (default): the first branch failure fails the parallel step immediately.
   * `'continue'`: every branch runs to completion regardless of others failing; the parallel
   * step fails afterward if any branch did. `'require-all'`: identical outcome to
   * `'continue'` but documents the intent that every branch is mandatory (Section 96). */
  readonly partialFailurePolicy?: 'fail-fast' | 'continue' | 'require-all';
}

export type WorkflowStep<TState = unknown> =
  | FunctionStep<TState>
  | ToolStep<TState>
  | AgentStep<TState>
  | ApprovalStep<TState>
  | ConditionStep<TState>
  | ParallelStep<TState>;

export type AnyWorkflowStep = WorkflowStep<unknown>;

export interface WorkflowDefinition<TInput = unknown, TState = unknown, TOutput = unknown> {
  readonly id: string;
  readonly version: string;
  readonly name?: string;
  readonly description?: string;
  readonly inputSchema?: z.ZodType<TInput>;
  readonly stateSchema?: z.ZodType<TState>;
  readonly outputSchema?: z.ZodType<TOutput>;
  /** Builds the initial state from validated input (Section 84-85). */
  initialState(input: TInput): TState;
  /** Projects the final state into the workflow's declared output (Section 85). Defaults to
   * `state` itself, cast, when omitted. */
  toOutput?(state: TState): TOutput;
  readonly steps: readonly WorkflowStep<TState>[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type AnyWorkflowDefinition = WorkflowDefinition<unknown, unknown, unknown>;

/**
 * `TState` is driven entirely by the required `state` Zod schema - the same schema-first
 * pattern `input`/`output` already use, chosen deliberately over trying to infer it purely
 * from `initialState`'s return type: `TState` also appears CONTRAVARIANTLY across `steps`
 * (every step method takes `state` as a parameter), and TypeScript cannot reliably infer one
 * type parameter from both a covariant and a contravariant source in the same call - it falls
 * back to `unknown`. A required schema sidesteps that entirely and doubles as the runtime
 * validator Section 97 calls for ("Typed State... validated... checkpointable").
 */
export interface DefineWorkflowOptions<
  TStateSchema extends z.ZodType,
  TInputSchema extends z.ZodType | undefined = undefined,
  TOutputSchema extends z.ZodType | undefined = undefined,
> {
  readonly id: string;
  /** Persisted with every checkpoint (Section 104, 229) - bump this on any breaking change
   * to `steps`/state shape so a checkpoint from an old version is never resumed against an
   * incompatible definition (see engine.ts's `resume()`). */
  readonly version: string;
  readonly name?: string;
  readonly description?: string;
  readonly input?: TInputSchema;
  readonly state: TStateSchema;
  readonly output?: TOutputSchema;
  initialState(input: TInputSchema extends z.ZodType ? z.infer<TInputSchema> : unknown): z.infer<TStateSchema>;
  toOutput?(
    state: z.infer<TStateSchema>,
  ): TOutputSchema extends z.ZodType ? z.infer<TOutputSchema> : unknown;
  readonly steps: readonly WorkflowStep<z.infer<TStateSchema>>[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function defineWorkflow<
  TStateSchema extends z.ZodType,
  TInputSchema extends z.ZodType | undefined = undefined,
  TOutputSchema extends z.ZodType | undefined = undefined,
>(
  options: DefineWorkflowOptions<TStateSchema, TInputSchema, TOutputSchema>,
): WorkflowDefinition<
  TInputSchema extends z.ZodType ? z.infer<TInputSchema> : unknown,
  z.infer<TStateSchema>,
  TOutputSchema extends z.ZodType ? z.infer<TOutputSchema> : unknown
> {
  type TInput = TInputSchema extends z.ZodType ? z.infer<TInputSchema> : unknown;
  type TState = z.infer<TStateSchema>;
  type TOutput = TOutputSchema extends z.ZodType ? z.infer<TOutputSchema> : unknown;

  const definition: WorkflowDefinition<TInput, TState, TOutput> = {
    id: options.id,
    version: options.version,
    name: options.name,
    description: options.description,
    inputSchema: options.input as z.ZodType<TInput> | undefined,
    stateSchema: options.state as z.ZodType<TState>,
    outputSchema: options.output as z.ZodType<TOutput> | undefined,
    initialState: (input) => options.initialState(input),
    toOutput: options.toOutput ? (state) => options.toOutput?.(state) as TOutput : undefined,
    steps: options.steps,
    metadata: options.metadata,
  };
  validateWorkflowGraph(definition);
  return definition;
}

export interface WorkflowValidationError {
  readonly reason:
    | 'DUPLICATE_STEP_ID'
    | 'UNKNOWN_DEPENDENCY'
    | 'CYCLE_DETECTED'
    | 'UNKNOWN_BRANCH'
    | 'BRANCH_NOT_INDEPENDENT';
  readonly stepId?: string;
  readonly message: string;
}

/**
 * Registration-time validation (Section 163, 192): unique step ids, dependencies resolve to
 * real sibling steps, no cycles, and every `ParallelStep.branches` entry resolves to a real
 * sibling step that is not itself independently reachable from the top level (Section 164 -
 * "do not require every workflow to be a complex graph," but a genuinely malformed graph
 * fails loudly here rather than at run time).
 */
export function validateWorkflowGraph(definition: AnyWorkflowDefinition): readonly WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];
  const seen = new Set<string>();
  for (const step of definition.steps) {
    if (seen.has(step.id)) {
      errors.push({ reason: 'DUPLICATE_STEP_ID', stepId: step.id, message: `Duplicate step id "${step.id}".` });
    }
    seen.add(step.id);
  }

  const byId = new Map(definition.steps.map((step) => [step.id, step]));
  for (const step of definition.steps) {
    for (const dependencyId of step.dependencies ?? []) {
      if (!byId.has(dependencyId)) {
        errors.push({
          reason: 'UNKNOWN_DEPENDENCY',
          stepId: step.id,
          message: `Step "${step.id}" depends on unknown step "${dependencyId}".`,
        });
      }
    }
    if (step.type === 'parallel') {
      for (const branchId of step.branches) {
        if (!byId.has(branchId)) {
          errors.push({
            reason: 'UNKNOWN_BRANCH',
            stepId: step.id,
            message: `Parallel step "${step.id}" references unknown branch step "${branchId}".`,
          });
        }
      }
    }
  }

  const branchStepIds = new Set(
    definition.steps.filter((step) => step.type === 'parallel').flatMap((step) => step.branches),
  );
  for (const step of definition.steps) {
    if (step.type !== 'parallel' && branchStepIds.has(step.id) && (step.dependencies?.length ?? 0) > 0) {
      // A branch step is executed only as part of its parallel step's body - it must not
      // also carry top-level dependencies that would make the main DAG walk try to run it
      // independently first.
      errors.push({
        reason: 'BRANCH_NOT_INDEPENDENT',
        stepId: step.id,
        message: `Step "${step.id}" is used as a parallel branch and must not declare its own "dependencies".`,
      });
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(definition.steps.map((step) => [step.id, WHITE]));
  let cycleFound = false;
  function visit(stepId: string): void {
    if (cycleFound || color.get(stepId) === BLACK) return;
    if (color.get(stepId) === GRAY) {
      cycleFound = true;
      return;
    }
    color.set(stepId, GRAY);
    const step = byId.get(stepId);
    for (const dependencyId of step?.dependencies ?? []) {
      if (byId.has(dependencyId)) visit(dependencyId);
    }
    color.set(stepId, BLACK);
  }
  for (const step of definition.steps) visit(step.id);
  if (cycleFound) {
    errors.push({ reason: 'CYCLE_DETECTED', message: 'The workflow step graph contains a dependency cycle.' });
  }

  if (errors.length > 0) {
    throw CopilotError.workflowDefinitionInvalid(
      `Workflow "${definition.id}" failed graph validation.`,
      { workflowId: definition.id, errors: errors.map((error) => error.message) },
    );
  }
  return errors;
}
