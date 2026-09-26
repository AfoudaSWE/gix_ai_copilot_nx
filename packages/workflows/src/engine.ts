import { CopilotError, createRunId, createThreadId, createToolCallId } from '@gixcopilot/protocol';
import type { PublicCopilotError } from '@gixcopilot/protocol';
import { METRICS, SPAN_NAMES, recordProtocolEvent, recordRun, withTelemetryMetadata } from '@gixcopilot/telemetry';
import type { SpanHandle, TelemetryAdapter } from '@gixcopilot/telemetry';
import type { ToolRuntime } from '@gixcopilot/tools';
import type { AgentRuntime } from '@gixcopilot/agents';
import type { ApprovalStore, SecurityContext } from '@gixcopilot/security';

import type {
  AgentStep,
  AnyWorkflowDefinition,
  ApprovalStep,
  ConditionStep,
  FunctionStep,
  ParallelStep,
  ToolStep,
  WorkflowStep,
  WorkflowStepContext,
} from './definition.js';
import type { CheckpointStore } from './checkpoint.js';
import { createInMemoryCheckpointStore } from './checkpoint.js';
import type { JobExecutor } from './jobs.js';
import { createInlineJobExecutor, workflowStepJobId } from './jobs.js';
import { DEFAULT_WORKFLOW_RETRY_POLICY, computeStepBackoffMs, isStepErrorRetryable, sleep } from './retry.js';
import type { RetryPolicy } from './retry.js';
import { buildCompensationPlan } from './compensation.js';
import type { WorkflowCheckpoint, WorkflowStepRecord, WorkflowStepStatus } from './state.js';
import {
  workflowCheckpointSavedEvent,
  workflowRunCancelledEvent,
  workflowRunCompletedEvent,
  workflowRunFailedEvent,
  workflowRunPausedEvent,
  workflowRunResumedEvent,
  workflowRunStartedEvent,
  workflowStepCompletedEvent,
  workflowStepFailedEvent,
  workflowStepStartedEvent,
} from './events.js';
import type { WorkflowEventCorrelation, WorkflowEventListener } from './events.js';
import { defaultWorkflowTelemetry, endSpanError, endSpanOk, recordHistoricalSpan, startChildSpan } from './tracing.js';
import type { WorkflowSpanCorrelation } from './tracing.js';

export interface CreateWorkflowEngineOptions {
  readonly telemetry?: TelemetryAdapter;
  readonly checkpointStore?: CheckpointStore;
  readonly jobExecutor?: JobExecutor;
  /** Required only if any registered workflow has a `'tool'` step. Every real tool call
   * still goes through this exact runtime (Section 90) - never bypasses Phase 5/7. */
  readonly toolRuntime?: ToolRuntime;
  /** Required only if any registered workflow has an `'agent'` step. */
  readonly agentRuntime?: AgentRuntime;
  /** Required only if any registered workflow has an `'approval'` step - reuses Phase 7's
   * real `ApprovalStore` state machine (Section 92, 125-126), never a second approval engine. */
  readonly approvals?: ApprovalStore;
  readonly retryPolicy?: RetryPolicy;
  readonly approvalExpiresInMs?: number;
}

export interface StartWorkflowOptions<TInput = unknown> {
  readonly workflowId: string;
  readonly input: TInput;
  readonly securityContext: SecurityContext;
  readonly tenantId?: string;
  readonly workflowRunId?: string;
  readonly signal?: AbortSignal;
  readonly onEvent?: WorkflowEventListener;
}

export interface ResumeWorkflowOptions {
  readonly securityContext?: SecurityContext;
  readonly signal?: AbortSignal;
  readonly onEvent?: WorkflowEventListener;
}

export interface WorkflowEngine {
  register(definition: AnyWorkflowDefinition): void;
  unregister(workflowId: string): void;
  getDefinition(workflowId: string): AnyWorkflowDefinition | undefined;
  start<TInput>(options: StartWorkflowOptions<TInput>): Promise<WorkflowCheckpoint>;
  /** Idempotent (Section 225): a checkpoint already in a terminal status, or still genuinely
   * waiting on an undecided approval, is returned unchanged rather than re-executed. */
  resume(workflowRunId: string, options?: ResumeWorkflowOptions): Promise<WorkflowCheckpoint>;
  /** `securityContext` is required (Section 130, 204): a tenant-scoped checkpoint can only
   * be cancelled by a caller whose own trusted tenant matches. */
  cancel(workflowRunId: string, securityContext?: SecurityContext): Promise<WorkflowCheckpoint>;
  getCheckpoint(workflowRunId: string, securityContext?: SecurityContext): Promise<WorkflowCheckpoint | undefined>;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'dead_lettered']);

/**
 * Mandatory tenant isolation (Section 129-130, 204): a checkpoint created under one tenant
 * must never be inspected, resumed, cancelled, or approved by a caller trusted for a
 * different tenant - checked against the CALLER's own trusted `SecurityContext`, never a
 * tenant id the caller merely claims in an argument. A checkpoint with no `tenantId` at all
 * (an anonymous/single-tenant deployment) has nothing to isolate against.
 */
function assertTenantMatch(checkpoint: WorkflowCheckpoint, securityContext: SecurityContext | undefined): void {
  if (!checkpoint.tenantId) return;
  if (securityContext?.tenant?.tenantId !== checkpoint.tenantId) {
    throw CopilotError.tenantMismatch(
      `Workflow run "${checkpoint.workflowRunId}" belongs to a different tenant.`,
    );
  }
}

/** For object-shaped state, returns only the keys of `after` that actually differ from
 * `before` (see runParallelBranches's join). For non-object state, there is no generic way
 * to isolate a "change," so `after` itself is returned wholesale. */
function changedKeys<TState>(before: TState, after: TState): Partial<TState> {
  if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) {
    return after;
  }
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  const diff: Record<string, unknown> = {};
  for (const key of Object.keys(afterRecord)) {
    if (!Object.is(beforeRecord[key], afterRecord[key])) diff[key] = afterRecord[key];
  }
  return diff as Partial<TState>;
}

function stepRecord(
  records: readonly WorkflowStepRecord[],
  stepId: string,
): WorkflowStepRecord | undefined {
  return records.find((record) => record.stepId === stepId);
}

function withStepRecord(
  records: readonly WorkflowStepRecord[],
  stepId: string,
  status: WorkflowStepStatus,
  attempt: number,
  error?: PublicCopilotError,
): readonly WorkflowStepRecord[] {
  const next: WorkflowStepRecord = { stepId, status, attempt, ...(error !== undefined ? { error } : {}) };
  const existingIndex = records.findIndex((record) => record.stepId === stepId);
  if (existingIndex === -1) return [...records, next];
  return records.map((record, index) => (index === existingIndex ? next : record));
}

/**
 * The deterministic workflow engine (Section 82-83): business processes that should be
 * controlled orchestration, not an autonomous agent's own judgment. Steps run in dependency
 * order; every step's outcome is checkpointed via `CheckpointStore` before the next one
 * starts (Section 100), so a process restart resumes from the last completed step, not from
 * scratch (Section 110, 198, 209).
 */
export function createWorkflowEngine(options: CreateWorkflowEngineOptions = {}): WorkflowEngine {
  const telemetry = options.telemetry ?? defaultWorkflowTelemetry;
  const metric = (name: string, value = 1): void => telemetry.recordMetric({ name, kind: 'counter', value, attributes: {} });
  // Every event a caller receives also reaches the diagnostics channel (Phase 11 Section 149)
  // so DevTools' workflow graph is built from exactly what was emitted.
  const observeEvents = (listener: WorkflowEventListener | undefined, tenantId: string | undefined): WorkflowEventListener | undefined =>
    telemetry.enabled
      ? (event) => {
          recordProtocolEvent(telemetry, event, { tenantId });
          listener?.(event);
        }
      : listener;
  const checkpointStore = options.checkpointStore ?? createInMemoryCheckpointStore();
  const jobExecutor = options.jobExecutor ?? createInlineJobExecutor();
  const retryPolicy = options.retryPolicy ?? DEFAULT_WORKFLOW_RETRY_POLICY;
  const definitions = new Map<string, AnyWorkflowDefinition>();

  function requireDefinition(workflowId: string): AnyWorkflowDefinition {
    const definition = definitions.get(workflowId);
    if (!definition) throw CopilotError.workflowNotFound(workflowId);
    return definition;
  }

  /** Steps that belong to a parallel step's body are not part of the main topological walk -
   * they run only when their owning `ParallelStep` is reached. */
  function topLevelSteps(definition: AnyWorkflowDefinition): readonly WorkflowStep[] {
    const branchIds = new Set(
      definition.steps.filter((step) => step.type === 'parallel').flatMap((step) => step.branches),
    );
    return definition.steps.filter((step) => !branchIds.has(step.id));
  }

  function isStepDone(records: readonly WorkflowStepRecord[], stepId: string): boolean {
    const record = stepRecord(records, stepId);
    return record?.status === 'completed' || record?.status === 'skipped';
  }

  function nextRunnableStep(
    definition: AnyWorkflowDefinition,
    records: readonly WorkflowStepRecord[],
  ): WorkflowStep | undefined {
    for (const step of topLevelSteps(definition)) {
      if (isStepDone(records, step.id)) continue;
      const dependenciesDone = (step.dependencies ?? []).every((id) => isStepDone(records, id));
      if (dependenciesDone) return step;
    }
    return undefined;
  }

  async function runStepJob<TState>(
    definition: AnyWorkflowDefinition,
    checkpoint: WorkflowCheckpoint<TState>,
    step: WorkflowStep<TState>,
    context: WorkflowStepContext<TState>,
    correlation: WorkflowEventCorrelation,
    emit: WorkflowEventListener,
    sequence: () => number,
    parentSpan: SpanHandle | undefined,
    spanCorrelation: WorkflowSpanCorrelation,
  ): Promise<{ checkpoint: WorkflowCheckpoint<TState>; paused: boolean }> {
    const priorAttempt = stepRecord(checkpoint.steps, step.id)?.attempt ?? 0;
    const attempt = priorAttempt + 1;

    if (step.runIf && !step.runIf(context)) {
      const steps = withStepRecord(checkpoint.steps, step.id, 'skipped', attempt);
      const saved = await saveCheckpoint({ ...checkpoint, steps });
      return { checkpoint: saved, paused: false };
    }

    emit(workflowStepStartedEvent(correlation, sequence(), checkpoint.workflowRunId, step.id, step.type, attempt));
    metric(METRICS.workflowSteps);
    const stepSpan = startChildSpan(telemetry, SPAN_NAMES.workflowStep, parentSpan, spanCorrelation, {
      'copilot.step_id': step.id,
      'copilot.step_type': step.type,
      'copilot.attempt': attempt,
    });

    try {
      if (step.type === 'approval') {
        const outcome = await runApprovalStep(checkpoint, step, context, correlation, emit, sequence, attempt);
        endSpanOk(stepSpan);
        return outcome;
      }

      const newState = await runStepBody(step, context, stepSpan);
      const steps = withStepRecord(checkpoint.steps, step.id, 'completed', attempt);
      const saved = await saveCheckpoint({ ...checkpoint, state: newState, steps });
      emit(workflowCheckpointSavedEvent(correlation, sequence(), checkpoint.workflowRunId, step.id, saved.version));
      emit(workflowStepCompletedEvent(correlation, sequence(), checkpoint.workflowRunId, step.id, attempt));
      endSpanOk(stepSpan);
      return { checkpoint: saved, paused: false };
    } catch (caught) {
      endSpanError(stepSpan, caught);
      const error = CopilotError.isCopilotError(caught)
        ? caught
        : CopilotError.workflowStepExecutionError(caught instanceof Error ? caught.message : String(caught), {
            stepId: step.id,
          });
      const retryable = isStepErrorRetryable(error.toPublicJSON(), retryPolicy) && attempt < retryPolicy.maxAttempts;
      emit(
        workflowStepFailedEvent(
          correlation,
          sequence(),
          checkpoint.workflowRunId,
          step.id,
          attempt,
          error.toPublicJSON(),
          retryable,
        ),
      );

      if (retryable) {
        metric(METRICS.workflowRetries);
        const steps = withStepRecord(checkpoint.steps, step.id, 'pending', attempt, error.toPublicJSON());
        const saved = await saveCheckpoint({ ...checkpoint, steps });
        await sleep(computeStepBackoffMs(retryPolicy, attempt), context.signal);
        return runStepJob(definition, saved, step, context, correlation, emit, sequence, parentSpan, spanCorrelation);
      }

      const steps = withStepRecord(checkpoint.steps, step.id, 'failed', attempt, error.toPublicJSON());
      const failedCheckpoint = await saveCheckpoint({ ...checkpoint, steps });
      throw Object.assign(error, { __checkpoint: failedCheckpoint });
    }
  }

  async function runStepBody<TState>(
    step: WorkflowStep<TState>,
    context: WorkflowStepContext<TState>,
    parentSpan: SpanHandle | undefined,
  ): Promise<TState> {
    switch (step.type) {
      case 'function':
        return runFunctionStep(step, context);
      case 'tool':
        return runToolStep(step, context, false, parentSpan);
      case 'agent':
        return runAgentStep(step, context, parentSpan);
      case 'condition':
        return runConditionStep(step, context);
      case 'parallel':
        return runParallelStep(step);
      case 'approval':
        throw CopilotError.internal('Approval steps are handled by runApprovalStep, not runStepBody.');
      default: {
        const exhaustive: never = step;
        throw new Error(`Unhandled workflow step type: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  function runFunctionStep<TState>(step: FunctionStep<TState>, context: WorkflowStepContext<TState>): Promise<TState> {
    return Promise.resolve(step.run(context));
  }

  async function runToolStep<TState>(
    step: ToolStep<TState>,
    context: WorkflowStepContext<TState>,
    compensating: boolean,
    parentSpan?: SpanHandle,
  ): Promise<TState> {
    if (!options.toolRuntime) {
      throw CopilotError.workflowStepExecutionError('No ToolRuntime was configured for a tool step.', {
        stepId: step.id,
      });
    }
    const call = compensating && step.compensate ? step.compensate : step;
    const result = await options.toolRuntime.execute({
      toolCallId: createToolCallId(),
      name: compensating && step.compensate ? step.compensate.tool : step.tool,
      arguments: call.input(context),
      context: {
        runId: context.workflowRunId,
        signal: context.signal,
        metadata: withTelemetryMetadata({ securityContext: context.securityContext }, { correlation: { runId: context.workflowRunId, tenantId: context.securityContext.tenant?.tenantId }, parentSpan }),
      },
    });
    if (result.status === 'error') {
      throw new CopilotError(result.error.code, result.error.message, {
        retryable: result.error.retryable,
        metadata: result.error.metadata,
      });
    }
    return compensating ? context.state : step.updateState(context.state, result.data);
  }

  async function runAgentStep<TState>(
    step: AgentStep<TState>,
    context: WorkflowStepContext<TState>,
    parentSpan: SpanHandle | undefined,
  ): Promise<TState> {
    if (!options.agentRuntime) {
      throw CopilotError.workflowStepExecutionError('No AgentRuntime was configured for an agent step.', {
        stepId: step.id,
      });
    }
    const result = await options.agentRuntime.run({
      agent: step.agent,
      input: step.input(context),
      securityContext: context.securityContext,
      signal: context.signal,
      // Nests the agent's own "agent.run" span tree under this workflow step's span (Section
      // 151's "Agent Step > Agent Run") - `AgentRunOptions.otelParentContext` is an internal
      // field `@gixcopilot/agents` itself only ever sets on delegation/handoff, but nothing
      // stops a trusted host (this engine) from setting it too.
      parentSpan,
    });
    if (result.status !== 'completed') {
      throw new CopilotError(
        result.error?.code ?? 'AGENT_EXECUTION_ERROR',
        result.error?.message ?? `Agent step "${step.id}" did not complete.`,
      );
    }
    return step.updateState(context.state, result.output);
  }

  function runConditionStep<TState>(step: ConditionStep<TState>, context: WorkflowStepContext<TState>): TState {
    return step.updateState(context.state, step.evaluate(context));
  }

  function runParallelStep<TState>(step: ParallelStep<TState>): Promise<TState> {
    // Top-level parallel steps are dispatched via `runParallelBranches` in `runLoop`, which
    // needs the full checkpoint/correlation context this function does not have. A parallel
    // step nested as another parallel step's own branch is deliberately not supported
    // (Section 164's "do not require every workflow to be a complex graph") - reached only
    // if a workflow definition does that, and fails loudly rather than silently misbehaving.
    throw CopilotError.workflowDefinitionInvalid(
      `Parallel step "${step.id}" cannot be used as a branch of another parallel step.`,
      { stepId: step.id },
    );
  }

  async function runApprovalStep<TState>(
    checkpoint: WorkflowCheckpoint<TState>,
    step: ApprovalStep<TState>,
    context: WorkflowStepContext<TState>,
    correlation: WorkflowEventCorrelation,
    emit: WorkflowEventListener,
    sequence: () => number,
    attempt: number,
  ): Promise<{ checkpoint: WorkflowCheckpoint<TState>; paused: boolean }> {
    if (!options.approvals) {
      throw CopilotError.workflowStepExecutionError('No ApprovalStore was configured for an approval step.', {
        stepId: step.id,
      });
    }
    const approvalId = createToolCallId();
    await options.approvals.create({
      approvalId,
      actionId: `${checkpoint.workflowRunId}:${step.id}`,
      runId: checkpoint.workflowRunId,
      toolCallId: approvalId,
      requestedBy: context.securityContext.identity?.subject,
      tenantId: context.securityContext.tenant?.tenantId,
      approvalLevel: step.approval ?? 'supervisor',
      summary: step.summary(context),
      risk: step.risk,
      reversibility: step.reversibility,
      requiredPermissions: step.requiredPermissions,
      expiresInMs: options.approvalExpiresInMs,
    });

    const steps = withStepRecord(checkpoint.steps, step.id, 'pending', attempt);
    const paused = await saveCheckpoint({
      ...checkpoint,
      status: 'waiting_for_approval',
      steps,
      pendingApproval: { stepId: step.id, approvalId },
    });
    emit(workflowRunPausedEvent(correlation, sequence(), checkpoint.workflowId, checkpoint.workflowRunId, 'approval', step.id));
    return { checkpoint: paused, paused: true };
  }

  async function saveCheckpoint<TState>(checkpoint: WorkflowCheckpoint<TState>): Promise<WorkflowCheckpoint<TState>> {
    metric(METRICS.workflowCheckpoints);
    return checkpointStore.save({ ...checkpoint, updatedAt: new Date().toISOString() });
  }

  async function runCompensation<TState>(
    definition: AnyWorkflowDefinition,
    checkpoint: WorkflowCheckpoint<TState>,
    context: WorkflowStepContext<TState>,
    correlation: WorkflowEventCorrelation,
    emit: WorkflowEventListener,
    sequence: () => number,
  ): Promise<void> {
    const plan = buildCompensationPlan(definition.steps, checkpoint.steps);
    for (const step of plan) {
      metric(METRICS.workflowCompensations);
      emit(workflowStepStartedEvent(correlation, sequence(), checkpoint.workflowRunId, step.id, 'tool', 1, 'compensation'));
      try {
        await runToolStep(step as ToolStep<TState>, context, true);
        emit(workflowStepCompletedEvent(correlation, sequence(), checkpoint.workflowRunId, step.id, 1, 'compensation'));
      } catch (caught) {
        const error = CopilotError.isCopilotError(caught)
          ? caught
          : CopilotError.workflowCompensationFailed(caught instanceof Error ? caught.message : String(caught), {
              stepId: step.id,
            });
        // Best effort (Section 120): one compensation failing does not stop the rest.
        emit(
          workflowStepFailedEvent(
            correlation,
            sequence(),
            checkpoint.workflowRunId,
            step.id,
            1,
            error.toPublicJSON(),
            false,
            'compensation',
          ),
        );
      }
    }
  }

  async function runLoop<TState>(
    definition: AnyWorkflowDefinition,
    startCheckpoint: WorkflowCheckpoint<TState>,
    securityContext: SecurityContext,
    signal: AbortSignal,
    onEvent: WorkflowEventListener | undefined,
  ): Promise<WorkflowCheckpoint<TState>> {
    let checkpoint = startCheckpoint;
    const correlation: WorkflowEventCorrelation = {
      runId: checkpoint.workflowRunId,
      threadId: createThreadId(),
    };
    let seq = 0;
    const sequence = (): number => {
      seq += 1;
      return seq;
    };
    const emit: WorkflowEventListener = (event) => onEvent?.(event);

    const spanCorrelation: WorkflowSpanCorrelation = {
      workflowRunId: checkpoint.workflowRunId,
      workflowId: checkpoint.workflowId,
      tenantId: checkpoint.tenantId,
    };
    // One "workflow.run" span per `runLoop` invocation (Section 149-152) - a real pause/resume
    // cycle spans a process boundary (`start()` can return while paused, resumed by a later,
    // separate `resume()` call with nothing of this process's memory available), so this is a
    // span per continuous IN-PROCESS execution segment, not a single span for the run's entire
    // lifetime; every segment still carries the same `copilot.run_id` correlation attribute,
    // so they remain joinable in a trace backend even though not literally one span tree.
    const runSpan = startChildSpan(telemetry, SPAN_NAMES.workflowRun, undefined, spanCorrelation, {
      'copilot.workflow_version': definition.version,
      // Graph shape for DevTools/eval reproducibility (Phase 11 Section 148): ids, types and
      // dependency edges only - `id:type:dep1|dep2`, comma-separated.
      'copilot.workflow.steps': definition.steps
        .map((step) => `${step.id}:${step.type}:${(step.dependencies ?? []).join('|')}`)
        .join(','),
    });
    const startedAt = Date.now();
    const report = (phase: 'started' | 'completed' | 'failed' | 'cancelled', error?: PublicCopilotError): void =>
      recordRun(telemetry, { kind: 'workflow', phase, correlation: { runId: checkpoint.workflowRunId, tenantId: checkpoint.tenantId }, label: definition.id, latencyMs: phase === 'started' ? undefined : Date.now() - startedAt, error });
    report('started');

    while (true) {
      if (signal.aborted) {
        const steps = checkpoint.steps;
        checkpoint = await saveCheckpoint({ ...checkpoint, status: 'cancelled', steps });
        emit(workflowRunCancelledEvent(correlation, sequence(), checkpoint.workflowId, checkpoint.workflowRunId));
        endSpanError(runSpan, new Error('Workflow run cancelled.'));
        report('cancelled');
        return checkpoint;
      }

      const step = nextRunnableStep(definition, checkpoint.steps) as WorkflowStep<TState> | undefined;
      if (!step) {
        const output = definition.toOutput ? definition.toOutput(checkpoint.state) : checkpoint.state;
        checkpoint = await saveCheckpoint({ ...checkpoint, status: 'completed', state: output as TState });
        emit(workflowRunCompletedEvent(correlation, sequence(), checkpoint.workflowId, checkpoint.workflowRunId));
        endSpanOk(runSpan);
        report('completed');
        return checkpoint;
      }

      const context: WorkflowStepContext<TState> = {
        state: checkpoint.state,
        workflowRunId: checkpoint.workflowRunId,
        securityContext,
        signal,
      };

      let outcome: { checkpoint: WorkflowCheckpoint<TState>; paused: boolean };
      try {
        if (step.type === 'parallel') {
          outcome = await runParallelBranches(
            definition,
            checkpoint,
            step,
            context,
            correlation,
            emit,
            sequence,
            runSpan,
            spanCorrelation,
          );
        } else {
          const jobId = workflowStepJobId(checkpoint.workflowRunId, step.id, (stepRecord(checkpoint.steps, step.id)?.attempt ?? 0) + 1);
          let jobResult: { checkpoint: WorkflowCheckpoint<TState>; paused: boolean } | undefined;
          await jobExecutor.schedule(jobId, async () => {
            jobResult = await runStepJob(
              definition,
              checkpoint,
              step,
              context,
              correlation,
              emit,
              sequence,
              runSpan,
              spanCorrelation,
            );
          });
          outcome = jobResult as { checkpoint: WorkflowCheckpoint<TState>; paused: boolean };
        }
      } catch (caught) {
        const checkpointFromError = (caught as { __checkpoint?: WorkflowCheckpoint<TState> }).__checkpoint;
        const failed = checkpointFromError ?? checkpoint;
        const error = CopilotError.isCopilotError(caught)
          ? caught.toPublicJSON()
          : CopilotError.workflowStepExecutionError(caught instanceof Error ? caught.message : String(caught)).toPublicJSON();

        await runCompensation(definition, failed, context, correlation, emit, sequence);

        checkpoint = await saveCheckpoint({ ...failed, status: 'failed', error });
        emit(workflowRunFailedEvent(correlation, sequence(), checkpoint.workflowId, checkpoint.workflowRunId, error));
        endSpanError(runSpan, caught);
        report('failed', error);
        return checkpoint;
      }

      checkpoint = outcome.checkpoint;
      if (outcome.paused) {
        endSpanOk(runSpan);
        return checkpoint;
      }
    }
  }

  async function runParallelBranches<TState>(
    definition: AnyWorkflowDefinition,
    checkpoint: WorkflowCheckpoint<TState>,
    step: ParallelStep<TState>,
    context: WorkflowStepContext<TState>,
    correlation: WorkflowEventCorrelation,
    emit: WorkflowEventListener,
    sequence: () => number,
    parentSpan: SpanHandle | undefined,
    spanCorrelation: WorkflowSpanCorrelation,
  ): Promise<{ checkpoint: WorkflowCheckpoint<TState>; paused: boolean }> {
    const byId = new Map(definition.steps.map((candidate) => [candidate.id, candidate as WorkflowStep<TState>]));
    // `partialFailurePolicy` governs how the OUTCOME is judged once every branch settles -
    // `Promise.allSettled` always lets every branch run to completion regardless of policy
    // (a true early-abort "fail-fast" would need per-branch cancellation, not implemented
    // here); `'fail-fast'` and `'continue'`/`'require-all'` therefore behave identically in
    // this runtime except that `'fail-fast'` is the illustrative default (Section 96).
    const attempt = (stepRecord(checkpoint.steps, step.id)?.attempt ?? 0) + 1;
    emit(workflowStepStartedEvent(correlation, sequence(), checkpoint.workflowRunId, step.id, 'parallel', attempt));
    const parallelSpan = startChildSpan(telemetry, SPAN_NAMES.workflowStep, parentSpan, spanCorrelation, {
      'copilot.step_id': step.id,
      'copilot.step_type': 'parallel',
      'copilot.attempt': attempt,
    });

    const results = await Promise.allSettled(
      step.branches.map(async (branchId) => {
        const branchStep = byId.get(branchId);
        if (!branchStep) throw CopilotError.workflowStepNotFound(branchId);
        const branchContext: WorkflowStepContext<TState> = { ...context, state: checkpoint.state };
        const branchSpan = startChildSpan(telemetry, SPAN_NAMES.workflowStep, parallelSpan, spanCorrelation, {
          'copilot.step_id': branchId,
          'copilot.step_type': branchStep.type,
          'copilot.parallel_branch_of': step.id,
        });
        try {
          const result = await runStepBody(branchStep, branchContext, branchSpan);
          endSpanOk(branchSpan);
          return result;
        } catch (error) {
          endSpanError(branchSpan, error);
          throw error;
        }
      }),
    );

    let current = checkpoint;
    let mergedState: TState = checkpoint.state;
    const failures: CopilotError[] = [];
    results.forEach((result, index) => {
      const branchId = step.branches[index] ?? step.id;
      if (result.status === 'fulfilled') {
        // Each branch computes independently from the SAME starting state (Section 95's
        // "independent branches") and returns its own full new state - including an
        // unmodified, now-stale copy of every key it did not itself change. Merging full
        // objects naively would let one branch's stale copy of a key silently overwrite
        // another branch's real update to that same key, so only each branch's ACTUAL
        // changes (a diff against the pre-parallel state) are applied onto the accumulator.
        mergedState = { ...mergedState, ...changedKeys(checkpoint.state, result.value) };
        current = { ...current, steps: withStepRecord(current.steps, branchId, 'completed', 1) };
      } else {
        const error = CopilotError.isCopilotError(result.reason)
          ? result.reason
          : CopilotError.workflowStepExecutionError(
              result.reason instanceof Error ? result.reason.message : String(result.reason),
              { stepId: branchId },
            );
        failures.push(error);
        current = { ...current, steps: withStepRecord(current.steps, branchId, 'failed', 1, error.toPublicJSON()) };
      }
    });

    if (failures.length > 0) {
      const firstError = failures[0] ?? CopilotError.workflowStepExecutionError('A parallel branch failed.');
      const steps = withStepRecord(current.steps, step.id, 'failed', attempt, firstError.toPublicJSON());
      const saved = await saveCheckpoint({ ...current, steps });
      emit(
        workflowStepFailedEvent(correlation, sequence(), checkpoint.workflowRunId, step.id, attempt, firstError.toPublicJSON(), false),
      );
      endSpanError(parallelSpan, firstError);
      throw Object.assign(firstError, { __checkpoint: saved });
    }

    const steps = withStepRecord(current.steps, step.id, 'completed', attempt);
    const saved = await saveCheckpoint({ ...current, state: mergedState, steps });
    emit(workflowStepCompletedEvent(correlation, sequence(), checkpoint.workflowRunId, step.id, attempt));
    endSpanOk(parallelSpan);
    return { checkpoint: saved, paused: false };
  }

  return {
    register(definition) {
      definitions.set(definition.id, definition);
    },
    unregister(workflowId) {
      definitions.delete(workflowId);
    },
    getDefinition(workflowId) {
      return definitions.get(workflowId);
    },

    async start(startOptions) {
      const definition = requireDefinition(startOptions.workflowId);
      if (definition.inputSchema) {
        const parsed = definition.inputSchema.safeParse(startOptions.input);
        if (!parsed.success) {
          throw CopilotError.workflowInputInvalid(`Invalid input for workflow "${definition.id}".`, {
            workflowId: definition.id,
            issueCount: parsed.error.issues.length,
          });
        }
      }

      const workflowRunId = startOptions.workflowRunId ?? createRunId();
      const initialState = definition.initialState(startOptions.input);
      const now = new Date().toISOString();
      const initial: WorkflowCheckpoint = {
        workflowId: definition.id,
        workflowVersion: definition.version,
        workflowRunId,
        tenantId: startOptions.tenantId ?? startOptions.securityContext.tenant?.tenantId,
        status: 'running',
        state: initialState,
        steps: [],
        version: 0,
        createdAt: now,
        updatedAt: now,
      };
      const saved = await checkpointStore.save(initial);

      const correlation: WorkflowEventCorrelation = { runId: workflowRunId, threadId: createThreadId() };
      const onEvent = observeEvents(startOptions.onEvent, initial.tenantId);
      onEvent?.(workflowRunStartedEvent(correlation, 1, definition.id, workflowRunId));

      const signal = startOptions.signal ?? new AbortController().signal;
      return runLoop(definition, saved, startOptions.securityContext, signal, onEvent);
    },

    async resume(workflowRunId, resumeOptions = {}) {
      const existing = await checkpointStore.load(workflowRunId);
      if (!existing) throw CopilotError.workflowCheckpointNotFound(workflowRunId);
      assertTenantMatch(existing, resumeOptions.securityContext);
      if (TERMINAL_STATUSES.has(existing.status)) return existing;

      const definition = requireDefinition(existing.workflowId);
      if (definition.version !== existing.workflowVersion) {
        throw CopilotError.workflowResumeFailed(
          `Checkpoint for run "${workflowRunId}" was created against workflow version "${existing.workflowVersion}", but the registered workflow is now version "${definition.version}".`,
          { workflowRunId, checkpointVersion: existing.workflowVersion, definitionVersion: definition.version },
        );
      }

      const securityContext = resumeOptions.securityContext ?? { tenant: existing.tenantId ? { tenantId: existing.tenantId } : undefined };
      const correlation: WorkflowEventCorrelation = { runId: workflowRunId, threadId: createThreadId() };
      let seq = 0;
      const onEvent = observeEvents(resumeOptions.onEvent, existing.tenantId);

      let checkpoint = existing;
      if (existing.status === 'waiting_for_approval' && existing.pendingApproval && options.approvals) {
        const approval = await options.approvals.get(existing.pendingApproval.approvalId);
        if (!approval || approval.status === 'pending') {
          return existing;
        }
        // The real wait happened entirely outside this process's memory, between the earlier
        // `start()`/`resume()` call that paused and this one (Section 125-126, the
        // observability skill's "approval waits are spans with explicit start/end") - recorded
        // retroactively now that the real decision timestamp is known, using the persisted
        // `ApprovalRequest`'s own timestamps rather than "now".
        recordHistoricalSpan(
          telemetry,
          SPAN_NAMES.approvalWait,
          undefined,
          { workflowRunId: existing.workflowRunId, workflowId: existing.workflowId, tenantId: existing.tenantId },
          new Date(approval.createdAt),
          new Date(approval.approvals.at(-1)?.at ?? Date.now()),
          { 'copilot.step_id': existing.pendingApproval.stepId, 'copilot.approval_id': existing.pendingApproval.approvalId, 'copilot.approval_status': approval.status },
          approval.status === 'approved',
        );
        telemetry.recordMetric({ name: METRICS.approvalWaitMs, kind: 'histogram', value: Math.max(0, new Date(approval.approvals.at(-1)?.at ?? Date.now()).getTime() - new Date(approval.createdAt).getTime()), attributes: { 'copilot.workflow_id': existing.workflowId } });
        seq += 1;
        if (approval.status === 'approved') {
          const steps = withStepRecord(existing.steps, existing.pendingApproval.stepId, 'completed', stepRecord(existing.steps, existing.pendingApproval.stepId)?.attempt ?? 1);
          checkpoint = await checkpointStore.save({ ...existing, status: 'running', steps, pendingApproval: undefined });
          onEvent?.(workflowRunResumedEvent(correlation, seq, checkpoint.workflowId, checkpoint.workflowRunId));
        } else {
          const code = approval.status === 'expired' ? 'WORKFLOW_APPROVAL_EXPIRED' : approval.status === 'cancelled' ? 'WORKFLOW_CANCELLED' : 'APPROVAL_REJECTED';
          const error = new CopilotError(code, `Approval for step "${existing.pendingApproval.stepId}" was ${approval.status}.`).toPublicJSON();
          const steps = withStepRecord(existing.steps, existing.pendingApproval.stepId, 'failed', stepRecord(existing.steps, existing.pendingApproval.stepId)?.attempt ?? 1, error);
          const context: WorkflowStepContext = { state: existing.state, workflowRunId, securityContext, signal: resumeOptions.signal ?? new AbortController().signal };
          const withFailedStep = { ...existing, steps };
          await runCompensation(definition, withFailedStep, context, correlation, (event) => onEvent?.(event), () => { seq += 1; return seq; });
          checkpoint = await checkpointStore.save({ ...withFailedStep, status: approval.status === 'cancelled' ? 'cancelled' : 'failed', error, pendingApproval: undefined });
          onEvent?.(workflowRunFailedEvent(correlation, seq, checkpoint.workflowId, checkpoint.workflowRunId, error));
          recordRun(telemetry, { kind: 'workflow', phase: checkpoint.status === 'cancelled' ? 'cancelled' : 'failed', correlation: { runId: workflowRunId, tenantId: checkpoint.tenantId }, label: checkpoint.workflowId, error });
          return checkpoint;
        }
      } else {
        checkpoint = await checkpointStore.save({ ...existing, status: 'running' });
        onEvent?.(workflowRunResumedEvent(correlation, 1, checkpoint.workflowId, checkpoint.workflowRunId));
      }

      const signal = resumeOptions.signal ?? new AbortController().signal;
      return runLoop(definition, checkpoint, securityContext, signal, onEvent);
    },

    async cancel(workflowRunId, securityContext) {
      const existing = await checkpointStore.load(workflowRunId);
      if (!existing) throw CopilotError.workflowCheckpointNotFound(workflowRunId);
      assertTenantMatch(existing, securityContext);
      if (TERMINAL_STATUSES.has(existing.status)) return existing;
      if (existing.pendingApproval && options.approvals) {
        await options.approvals.cancel(existing.pendingApproval.approvalId).catch(() => undefined);
      }
      const cancelled = await checkpointStore.save({ ...existing, status: 'cancelled' });
      recordRun(telemetry, { kind: 'workflow', phase: 'cancelled', correlation: { runId: workflowRunId, tenantId: existing.tenantId }, label: existing.workflowId });
      return cancelled;
    },

    async getCheckpoint(workflowRunId, securityContext) {
      const checkpoint = await checkpointStore.load(workflowRunId);
      if (checkpoint) assertTenantMatch(checkpoint, securityContext);
      return checkpoint;
    },
  };
}
