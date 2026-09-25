import { randomUUID } from 'node:crypto';
import { CopilotError, createRunId, createThreadId } from '@gixcopilot/protocol';
import type { PublicCopilotError, RunId, ThreadId, ToolResult, Usage } from '@gixcopilot/protocol';
import { METRICS, SPAN_NAMES, addUsage, recordRun, withTelemetryMetadata } from '@gixcopilot/telemetry';
import type { SpanHandle, TelemetryAdapter } from '@gixcopilot/telemetry';
import { EventSequencer } from '@gixcopilot/core';
import { toToolManifest } from '@gixcopilot/tools';
import type { AnyToolDefinition, ToolResolver, ToolRuntime } from '@gixcopilot/tools';
import { generateObject } from '@gixcopilot/provider';
import type { ModelMessage, ModelReference, ModelRuntime, ModelToolCall, ModelToolDefinition } from '@gixcopilot/provider';
import type { SecurityContext } from '@gixcopilot/security';

import { isAgentEnabled, resolveAgentInstructions, resolveAgentToolNames } from './definition.js';
import type { AgentInstructionsContext } from './definition.js';
import type { AgentExecutionContext } from './execution-context.js';
import type { AgentRegistry } from './registry.js';
import { defaultAgentTelemetry, endSpanError, endSpanOk, startChildSpan } from './tracing.js';
import {
  assertDelegationLimit,
  assertDepthLimit,
  assertIterationLimit,
  assertToolCallLimit,
  resolveAgentLimits,
} from './limits.js';
import {
  assertDelegationAllowed,
  delegateArgsSchema,
  delegateModelToolDefinition,
  intersectKnowledgeSources,
  intersectMemoryTypes,
  intersectToolNames,
  isDelegateToolCall,
  parseDelegateTargetId,
} from './delegation.js';
import {
  assertHandoffAllowed,
  handoffArgsSchema,
  handoffModelToolDefinition,
  isHandoffToolCall,
  parseHandoffTargetId,
} from './handoff.js';
import {
  agentDelegationCompletedEvent,
  agentDelegationStartedEvent,
  agentHandoffEvent,
  agentRunCancelledEvent,
  agentRunCompletedEvent,
  agentRunFailedEvent,
  agentRunStartedEvent,
} from './events.js';
import type { AgentEventCorrelation, AgentEventListener } from './events.js';

/** Shared across an entire delegation/handoff chain (Section 42-43) - tool-call and
 * delegation counts accumulate across every agent in the chain, not reset per hop, so a
 * cycle of cheap delegations cannot bypass the top-level run's own budget. */
export interface AgentRunBudget {
  toolCalls: number;
  delegations: number;
}

export interface AgentRunOptions<TInput = unknown> {
  readonly agent: string;
  readonly input: TInput;
  readonly securityContext: SecurityContext;
  readonly threadId?: ThreadId;
  readonly signal?: AbortSignal;
  readonly onEvent?: AgentEventListener;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Internal - set automatically by delegateTo()/handoff dispatch for a nested run. A
   * caller starting a fresh top-level run should never set these directly. */
  readonly rootRunId?: RunId;
  readonly parentRunId?: RunId;
  readonly depth?: number;
  readonly budget?: AgentRunBudget;
  /** Internal - least-privilege enforcement for a delegated/handed-off run (Section 55): the
   * nested run's visible tools are further intersected with this list. */
  readonly restrictToToolNames?: readonly string[];
  /** Internal - same least-privilege narrowing (Section 60, 131-132) applied to knowledge
   * sources / memory types instead of tools; set automatically by delegateTo()/handoff
   * dispatch, never by a fresh top-level caller. */
  readonly restrictToKnowledgeSources?: readonly string[];
  readonly restrictToMemoryTypes?: readonly ('working' | 'session' | 'durable' | 'semantic')[];
  /** Parent of this run's span, passed through delegation, handoff, or a host workflow. */
  readonly parentSpan?: SpanHandle;
}

export interface AgentRunResult<TOutput = unknown> {
  readonly runId: RunId;
  readonly agentId: string;
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly output?: TOutput;
  readonly error?: PublicCopilotError;
  readonly iterations: number;
  readonly toolCallCount: number;
  /** Present only when this run ended via a handoff - the result is actually the target
   * agent's, surfaced through the originating run (Section 61-63). */
  readonly handoff?: { readonly toAgentId: string };
}

export interface AgentRuntime {
  run<TInput = unknown, TOutput = unknown>(
    options: AgentRunOptions<TInput>,
  ): Promise<AgentRunResult<TOutput>>;
}

export interface CreateAgentRuntimeOptions {
  readonly registry: AgentRegistry;
  readonly telemetry?: TelemetryAdapter;
  readonly modelRuntime: ModelRuntime;
  /** Already wired with whatever middleware the caller needs (e.g. the Action Firewall via
   * `createActionFirewallMiddleware`, exactly as `@gixcopilot/server` does) - the agent
   * runtime never bypasses it and never constructs its own. */
  readonly toolRuntime: ToolRuntime;
  /** Discovery boundary (Section 34) - should already be permission-filtered by the caller
   * (e.g. via `createPermissionAwareToolResolver`) for the trusted user's own SecurityContext. */
  readonly toolResolver: ToolResolver;
}

function toModelToolDefinitions(tools: readonly AnyToolDefinition[]): readonly ModelToolDefinition[] {
  return toToolManifest(tools).map((entry) => ({
    name: entry.name,
    description: entry.description,
    parameters: entry.parameters,
  }));
}

function inputToUserText(input: unknown): string {
  if (typeof input === 'string') return input;
  if (
    input !== null &&
    typeof input === 'object' &&
    'message' in input &&
    typeof (input as { message?: unknown }).message === 'string'
  ) {
    return (input as { message: string }).message;
  }
  return JSON.stringify(input ?? {});
}

function toModelReference(model: { provider?: string; model?: string } | undefined): ModelReference | undefined {
  return model?.provider && model.model ? { provider: model.provider, model: model.model } : undefined;
}

/**
 * Errors that represent a runaway-execution safety violation (iteration/tool/delegation/
 * depth limits, Section 40-45), as opposed to an ordinary task failure. A delegation dispatch
 * must never silently absorb one of these into a soft tool-result-and-continue - doing so
 * would let the *parent* agent keep looping/re-delegating indefinitely even though the exact
 * safety limit that was supposed to stop that was already tripped one level down. Instead
 * these propagate (are rethrown) through every enclosing delegation dispatch, so the whole
 * chain terminates with the same safety error - still surfaced as an ordinary, non-throwing
 * `{status: 'failed'}` result once it reaches the outermost `runtime.run()` caller, since
 * every level's own top-level catch converts a propagated throw back into a result before
 * deciding whether to propagate further.
 */
function isAgentSafetyLimitError(error: PublicCopilotError | undefined): boolean {
  if (!error) return false;
  return (
    error.code === 'AGENT_ITERATION_LIMIT_EXCEEDED' ||
    error.code === 'AGENT_TOOL_LIMIT_EXCEEDED' ||
    error.code === 'AGENT_DELEGATION_LIMIT_EXCEEDED' ||
    error.code === 'AGENT_DELEGATION_DEPTH_EXCEEDED'
  );
}

/** Shared by the sequential and parallel delegation dispatch paths - a delegation's structured
 * result (Section 58) becomes a normal tool_result message either way. */
function delegationToolResultMessage(toolCallId: string, delegationResult: AgentRunResult): ModelMessage {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool_result',
        toolCallId,
        result:
          delegationResult.status === 'completed'
            ? {
                status: 'success',
                toolCallId,
                data: {
                  agentId: delegationResult.agentId,
                  runId: delegationResult.runId,
                  status: delegationResult.status,
                  output: delegationResult.output,
                },
              }
            : {
                status: 'error',
                toolCallId,
                error: delegationResult.error ?? CopilotError.agentExecutionError('Delegation failed.').toPublicJSON(),
              },
      },
    ],
  };
}

/**
 * The single-agent execution loop (Section 17-22): think/model -> action/tool -> observe ->
 * continue -> completed, implemented as one promise-returning call (matching the Phase 10
 * spec's own `await runtime.run(...)` example) rather than wrapping `@gixcopilot/core`'s
 * `Executor` boundary - an agent run's shape (structured result, delegation/handoff,
 * budget-tracked sub-runs) does not fit the plain text-delta `Executor` contract that boundary
 * exists for. Progress is still observable via `onEvent`, reusing the exact `CopilotEvent`
 * union `@gixcopilot/core`'s runtime already streams to clients (Section 139-141).
 *
 * Delegation and handoff are both offered to the model as reserved tools
 * (`agent.delegate.<id>`/`agent.handoff.<id>`, see delegation.ts/handoff.ts) so they flow
 * through the model's normal tool-calling mechanism, but they are intercepted here rather
 * than dispatched through the generic `ToolRuntime` - they need recursive access to this
 * same runtime, which a `ToolDefinition.execute()` cannot have without a dependency cycle.
 */
export function createAgentRuntime(options: CreateAgentRuntimeOptions): AgentRuntime {
  const telemetry = options.telemetry ?? defaultAgentTelemetry;
  async function runAgent<TInput, TOutput>(
    runOptions: AgentRunOptions<TInput>,
  ): Promise<AgentRunResult<TOutput>> {
    // A missing/disabled agent means no run ever conceptually started (Section 154) - fail
    // fast with a normal AgentRunResult, the same "never throw, always return a structured
    // outcome" posture `@gixcopilot/tools`' ToolRuntime already takes, rather than rejecting
    // the promise and forcing every caller to combine try/catch with a status check.
    const agent = options.registry.get(runOptions.agent);
    if (!agent) {
      return {
        runId: createRunId(),
        agentId: runOptions.agent,
        status: 'failed',
        error: CopilotError.agentNotFound(runOptions.agent).toPublicJSON(),
        iterations: 0,
        toolCallCount: 0,
      };
    }
    if (!isAgentEnabled(agent)) {
      return {
        runId: createRunId(),
        agentId: agent.id,
        status: 'failed',
        error: CopilotError.agentDisabled(agent.id).toPublicJSON(),
        iterations: 0,
        toolCallCount: 0,
      };
    }

    const limits = resolveAgentLimits(agent.limits);
    const depth = runOptions.depth ?? 0;
    const runId = createRunId();
    const threadId = runOptions.threadId ?? createThreadId();
    const rootRunId = runOptions.rootRunId ?? runId;
    const parentRunId = runOptions.parentRunId;
    const budget: AgentRunBudget = runOptions.budget ?? { toolCalls: 0, delegations: 0 };
    const externalSignal = runOptions.signal;
    const sequencer = new EventSequencer();
    const correlation: AgentEventCorrelation = { runId, threadId, rootRunId, parentRunId };
    const emit = (event: Parameters<AgentEventListener>[0]): void => runOptions.onEvent?.(event);

    emit(agentRunStartedEvent(correlation, sequencer, agent.id, runId));

    const startedAt = Date.now();
    let usage: Usage | undefined;
    const runSpan = startChildSpan(telemetry, SPAN_NAMES.agentRun, runOptions.parentSpan, correlation, {
      'copilot.agent_id': agent.id,
      'copilot.depth': depth,
      'copilot.tenant_id': runOptions.securityContext.tenant?.tenantId,
    });

    recordRun(telemetry, { kind: 'agent', phase: 'started', correlation, label: agent.id });
    telemetry.recordMetric({ name: 'copilot.agent.depth', kind: 'histogram', value: depth, attributes: { 'copilot.agent_id': agent.id } });
    const combinedController = new AbortController();
    let timedOut = false;
    const onExternalAbort = (): void => combinedController.abort();
    if (externalSignal?.aborted) {
      combinedController.abort();
    } else {
      externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    }
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      combinedController.abort();
    }, limits.timeoutMs);

    try {
      assertDepthLimit(depth, limits.maxDepth);

      let parsedInput: unknown = runOptions.input;
      if (agent.inputSchema) {
        const parsed = agent.inputSchema.safeParse(runOptions.input);
        if (!parsed.success) {
          throw CopilotError.agentInputInvalid(`Invalid input for agent "${agent.id}".`, {
            agentId: agent.id,
            issueCount: parsed.error.issues.length,
          });
        }
        parsedInput = parsed.data;
      }

      const instructionsContext: AgentInstructionsContext = {
        securityContext: runOptions.securityContext,
        input: parsedInput,
        metadata: runOptions.metadata,
      };
      const declaredToolNames = resolveAgentToolNames(agent, instructionsContext);
      const resolvedTools = await options.toolResolver.resolve({ runId, threadId });
      let toolNames =
        declaredToolNames.length > 0
          ? intersectToolNames(declaredToolNames, resolvedTools.map((tool) => tool.name))
          : [];
      if (runOptions.restrictToToolNames) {
        toolNames = intersectToolNames(toolNames, runOptions.restrictToToolNames);
      }
      const toolsForAgent = resolvedTools.filter((tool) => toolNames.includes(tool.name));

      // Declarative least-privilege narrowing for knowledge/memory (Section 60, 131-132),
      // mirroring toolNames above: a fresh top-level run keeps its own full declaration; a
      // delegated/handed-off run is further intersected with what its delegator could see.
      const resolvedKnowledgeSources = runOptions.restrictToKnowledgeSources
        ? intersectKnowledgeSources(agent.knowledge?.sources, runOptions.restrictToKnowledgeSources)
        : (agent.knowledge?.sources ?? []);
      const resolvedMemoryTypes = runOptions.restrictToMemoryTypes
        ? intersectMemoryTypes(agent.memory?.types, runOptions.restrictToMemoryTypes)
        : (agent.memory?.types ?? []);

      const executionContext: AgentExecutionContext = {
        runId,
        agentId: agent.id,
        threadId,
        rootRunId,
        parentRunId,
        depth,
        securityContext: runOptions.securityContext,
        signal: combinedController.signal,
        metadata: runOptions.metadata,
      };

      const delegateTargets = agent.delegation?.delegatesTo ?? [];
      const handoffTargets = agent.delegation?.handoffTargets ?? [];
      const modelTools: ModelToolDefinition[] = [
        ...toModelToolDefinitions(toolsForAgent),
        ...delegateTargets.map(delegateModelToolDefinition),
        ...handoffTargets.map(handoffModelToolDefinition),
      ];

      const systemText = resolveAgentInstructions(agent, instructionsContext);
      let messages: ModelMessage[] = [
        { role: 'system', content: [{ type: 'text', text: systemText }] },
        { role: 'user', content: [{ type: 'text', text: inputToUserText(parsedInput) }] },
      ];

      let iterations = 0;
      let aggregatedText = '';
      const modelRef = toModelReference(agent.model);

      while (true) {
        const toolCallsThisTurn: ModelToolCall[] = [];
        let turnText = '';
        let callUsage: Usage | undefined;

        for await (const event of options.modelRuntime.stream({
            model: modelRef,
            messages,
            temperature: agent.model?.temperature,
            maxOutputTokens: agent.model?.maxOutputTokens,
            signal: combinedController.signal,
            tools: modelTools.length > 0 ? modelTools : undefined,
            metadata: withTelemetryMetadata(runOptions.metadata, { correlation, parentSpan: runSpan }),
          })) {
            switch (event.type) {
              case 'model.started':
                break;
              case 'usage.updated':
                callUsage = event.usage;
                break;
              case 'content.delta':
                turnText += event.delta;
                break;
              case 'tool_call.requested':
                toolCallsThisTurn.push(event.toolCall);
                break;
              case 'model.completed':
                callUsage = event.usage ?? callUsage;
                break;
              case 'model.failed':
                throw new CopilotError(event.error.code, event.error.message, {
                  retryable: event.error.retryable,
                  metadata: event.error.metadata,
                });
              default: {
                const exhaustive: never = event;
                throw new Error(`Unhandled model stream event: ${JSON.stringify(exhaustive)}`);
              }
            }
          }
        usage = addUsage(usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, callUsage);

        aggregatedText += turnText;

        if (toolCallsThisTurn.length === 0) {
          break;
        }

        iterations += 1;
        assertIterationLimit(iterations, limits.maxIterations);

        messages = [
          ...messages,
          {
            role: 'assistant',
            content: toolCallsThisTurn.map((call) => ({
              type: 'tool_call' as const,
              toolCallId: call.id,
              name: call.name,
              arguments: call.arguments,
            })),
          },
        ];

        // Parallel specialist fan-out (Section 70-73, 189): the model requested more than one
        // delegation in the same turn and none of the calls this turn is a handoff (handoff
        // always terminates the run outright, so mixing it with concurrent delegation would be
        // ambiguous) - dispatch every delegation concurrently instead of one at a time, then
        // append each tool_result back in the model's own call order (not completion order) so
        // message ordering stays deterministic regardless of which specialist finishes first.
        const isParallelDelegationTurn =
          toolCallsThisTurn.length > 1 && toolCallsThisTurn.every((call) => isDelegateToolCall(call.name));

        if (isParallelDelegationTurn) {
          const parallelPolicy = agent.delegation?.parallelFailurePolicy ?? 'collect-results';
          // A dedicated controller for this batch (Section 71): under 'fail-fast', the first
          // failure aborts every still-in-flight sibling by tripping this controller, which
          // becomes each sibling's own externalSignal; under 'collect-results' every dispatch
          // simply shares the run's own combinedController.signal, so only the parent run being
          // cancelled stops them.
          const batchController = parallelPolicy === 'fail-fast' ? new AbortController() : undefined;
          if (batchController) {
            if (combinedController.signal.aborted) batchController.abort();
            else combinedController.signal.addEventListener('abort', () => batchController.abort(), { once: true });
          }
          const batchSignal = batchController?.signal ?? combinedController.signal;

          // Budget/depth checks and the started-event happen synchronously, per call, BEFORE
          // any dispatch's own await is reached - so every call's accounting is applied in
          // deterministic order even though the dispatches themselves race.
          const dispatches = toolCallsThisTurn.map((call) => {
            const targetId = parseDelegateTargetId(call.name);
            assertDelegationAllowed(agent, targetId);
            budget.delegations += 1;
            assertDelegationLimit(budget.delegations, limits.maxDelegations);
            assertDepthLimit(depth + 1, limits.maxDepth);
            const parsedArgs = delegateArgsSchema.safeParse(call.arguments);
            const task = parsedArgs.success ? parsedArgs.data.task : 'Delegated subtask.';
            const nestedInput =
              parsedArgs.success && parsedArgs.data.input !== undefined ? parsedArgs.data.input : { message: task };
            const delegationId = randomUUID();
            emit(agentDelegationStartedEvent(correlation, sequencer, agent.id, targetId, delegationId, depth + 1));
            telemetry.recordMetric({ name: METRICS.agentDelegations, kind: 'counter', value: 1, attributes: { 'copilot.agent_id': agent.id } });
            const delegationSpan = startChildSpan(telemetry, SPAN_NAMES.agentDelegate, runSpan, correlation, {
              'copilot.to_agent_id': targetId,
            });
            return { call, targetId, nestedInput, delegationId, delegationSpan };
          });

          const settled = await Promise.allSettled(
            dispatches.map(async (dispatch) => {
              try {
                const result = await runAgent({
                  agent: dispatch.targetId,
                  input: dispatch.nestedInput,
                  securityContext: runOptions.securityContext,
                  threadId,
                  signal: batchSignal,
                  onEvent: runOptions.onEvent,
                  rootRunId,
                  parentRunId: runId,
                  depth: depth + 1,
                  budget,
                  restrictToToolNames: toolNames,
                  restrictToKnowledgeSources: resolvedKnowledgeSources,
                  restrictToMemoryTypes: resolvedMemoryTypes,
                  parentSpan: dispatch.delegationSpan,
                });
                if (parallelPolicy === 'fail-fast' && result.status !== 'completed') batchController?.abort();
                if (result.status === 'completed') {
                  endSpanOk(dispatch.delegationSpan);
                } else {
                  endSpanError(
                    dispatch.delegationSpan,
                    new Error(result.error?.message ?? `Delegation ended with status "${result.status}".`),
                  );
                }
                return result;
              } catch (error) {
                endSpanError(dispatch.delegationSpan, error);
                batchController?.abort();
                throw error;
              }
            }),
          );

          for (let index = 0; index < dispatches.length; index += 1) {
            const dispatch = dispatches[index];
            if (!dispatch) continue;
            const outcome = settled[index];
            let delegationResult: AgentRunResult;
            if (outcome?.status === 'fulfilled') {
              delegationResult = outcome.value;
              emit(
                agentDelegationCompletedEvent(
                  correlation,
                  sequencer,
                  agent.id,
                  dispatch.targetId,
                  dispatch.delegationId,
                  delegationResult.status === 'completed' ? 'completed' : 'failed',
                  delegationResult.error,
                ),
              );
            } else {
              const reason: unknown = outcome?.status === 'rejected' ? outcome.reason : undefined;
              const copilotError = CopilotError.isCopilotError(reason)
                ? reason
                : CopilotError.agentExecutionError(reason instanceof Error ? reason.message : String(reason));
              emit(
                agentDelegationCompletedEvent(
                  correlation,
                  sequencer,
                  agent.id,
                  dispatch.targetId,
                  dispatch.delegationId,
                  'failed',
                  copilotError.toPublicJSON(),
                ),
              );
              delegationResult = {
                runId: createRunId(),
                agentId: dispatch.targetId,
                status: 'failed',
                error: copilotError.toPublicJSON(),
                iterations: 0,
                toolCallCount: 0,
              };
            }

            if (isAgentSafetyLimitError(delegationResult.error)) {
              throw new CopilotError(
                delegationResult.error?.code ?? 'AGENT_EXECUTION_ERROR',
                delegationResult.error?.message ?? 'A delegated run exceeded a safety limit.',
                { retryable: false, metadata: delegationResult.error?.metadata },
              );
            }

            messages = [...messages, delegationToolResultMessage(dispatch.call.id, delegationResult)];
          }

          continue;
        }

        for (const call of toolCallsThisTurn) {
          if (isHandoffToolCall(call.name)) {
            const targetId = parseHandoffTargetId(call.name);
            assertHandoffAllowed(agent, targetId);
            assertDepthLimit(depth + 1, limits.maxDepth);
            const parsedArgs = handoffArgsSchema.safeParse(call.arguments);
            const reason = parsedArgs.success ? parsedArgs.data.reason : 'Handoff requested.';
            const nestedInput =
              parsedArgs.success && parsedArgs.data.input !== undefined
                ? parsedArgs.data.input
                : { message: reason };
            emit(agentHandoffEvent(correlation, sequencer, agent.id, targetId, reason));
            telemetry.recordMetric({ name: METRICS.agentHandoffs, kind: 'counter', value: 1, attributes: { 'copilot.agent_id': agent.id } });
            const handoffSpan = startChildSpan(telemetry, SPAN_NAMES.agentHandoff, runSpan, correlation, {
              'copilot.to_agent_id': targetId,
            });
            let nestedResult: AgentRunResult<TOutput>;
            try {
              nestedResult = await runAgent<unknown, TOutput>({
                agent: targetId,
                input: nestedInput,
                securityContext: runOptions.securityContext,
                threadId,
                signal: combinedController.signal,
                onEvent: runOptions.onEvent,
                rootRunId,
                parentRunId: runId,
                depth: depth + 1,
                budget,
                restrictToToolNames: toolNames,
                restrictToKnowledgeSources: resolvedKnowledgeSources,
                restrictToMemoryTypes: resolvedMemoryTypes,
                parentSpan: handoffSpan,
              });
              endSpanOk(handoffSpan);
            } catch (error) {
              endSpanError(handoffSpan, error);
              throw error;
            }
            runSpan.end(nestedResult.status === 'completed' ? 'ok' : nestedResult.status === 'cancelled' ? 'cancelled' : 'error');
            recordRun(telemetry, { kind: 'agent', phase: nestedResult.status, correlation, label: agent.id, usage, latencyMs: Date.now() - startedAt, error: nestedResult.error });
            return { ...nestedResult, handoff: { toAgentId: targetId } };
          }

          if (isDelegateToolCall(call.name)) {
            const targetId = parseDelegateTargetId(call.name);
            assertDelegationAllowed(agent, targetId);
            budget.delegations += 1;
            assertDelegationLimit(budget.delegations, limits.maxDelegations);
            assertDepthLimit(depth + 1, limits.maxDepth);
            const parsedArgs = delegateArgsSchema.safeParse(call.arguments);
            const task = parsedArgs.success ? parsedArgs.data.task : 'Delegated subtask.';
            const nestedInput =
              parsedArgs.success && parsedArgs.data.input !== undefined
                ? parsedArgs.data.input
                : { message: task };
            const delegationId = randomUUID();
            emit(agentDelegationStartedEvent(correlation, sequencer, agent.id, targetId, delegationId, depth + 1));
            telemetry.recordMetric({ name: METRICS.agentDelegations, kind: 'counter', value: 1, attributes: { 'copilot.agent_id': agent.id } });
            const delegationSpan = startChildSpan(telemetry, SPAN_NAMES.agentDelegate, runSpan, correlation, {
              'copilot.to_agent_id': targetId,
            });

            let delegationResult: AgentRunResult;
            try {
              delegationResult = await runAgent({
                agent: targetId,
                input: nestedInput,
                securityContext: runOptions.securityContext,
                threadId,
                signal: combinedController.signal,
                onEvent: runOptions.onEvent,
                rootRunId,
                parentRunId: runId,
                depth: depth + 1,
                budget,
                restrictToToolNames: toolNames,
                restrictToKnowledgeSources: resolvedKnowledgeSources,
                restrictToMemoryTypes: resolvedMemoryTypes,
                parentSpan: delegationSpan,
              });
              emit(
                agentDelegationCompletedEvent(
                  correlation,
                  sequencer,
                  agent.id,
                  targetId,
                  delegationId,
                  delegationResult.status === 'completed' ? 'completed' : 'failed',
                  delegationResult.error,
                ),
              );
              endSpanOk(delegationSpan);
            } catch (error) {
              const copilotError = CopilotError.isCopilotError(error)
                ? error
                : CopilotError.agentExecutionError(error instanceof Error ? error.message : String(error));
              emit(
                agentDelegationCompletedEvent(
                  correlation,
                  sequencer,
                  agent.id,
                  targetId,
                  delegationId,
                  'failed',
                  copilotError.toPublicJSON(),
                ),
              );
              delegationResult = {
                runId: createRunId(),
                agentId: targetId,
                status: 'failed',
                error: copilotError.toPublicJSON(),
                iterations: 0,
                toolCallCount: 0,
              };
              endSpanError(delegationSpan, error);
            }

            if (isAgentSafetyLimitError(delegationResult.error)) {
              throw new CopilotError(
                delegationResult.error?.code ?? 'AGENT_EXECUTION_ERROR',
                delegationResult.error?.message ?? 'A delegated run exceeded a safety limit.',
                { retryable: false, metadata: delegationResult.error?.metadata },
              );
            }

            messages = [...messages, delegationToolResultMessage(call.id, delegationResult)];
            continue;
          }

          budget.toolCalls += 1;
          assertToolCallLimit(budget.toolCalls, limits.maxToolCalls);

          // Defense in depth (Section 34, 186): a tool must be in THIS agent's own resolved
          // allowlist - the same set offered to the model this turn - to ever execute, even
          // if the underlying ToolRuntime's resolver would otherwise find it. This is what
          // makes delegation/handoff's tool-name intersection (delegation.ts) an actual
          // enforcement boundary rather than only a discovery-time courtesy: a delegated
          // agent that declares a broader tool list than its delegator can see is stopped
          // here, not merely un-offered.
          const result: ToolResult = toolNames.includes(call.name)
            ? await options.toolRuntime.execute({
                toolCallId: call.id,
                name: call.name,
                arguments: call.arguments,
                context: {
                  runId,
                  threadId,
                  signal: combinedController.signal,
                  metadata: withTelemetryMetadata({
                    securityContext: executionContext.securityContext,
                    executionContext,
                    // A knowledge/memory-performing tool reads its already-narrowed scope from
                    // here rather than re-deriving delegation narrowing itself (Section 60).
                    knowledgeSources: resolvedKnowledgeSources,
                    memoryTypes: resolvedMemoryTypes,
                  }, { correlation, parentSpan: runSpan }),
                },
              })
            : {
                status: 'error',
                toolCallId: call.id,
                error: CopilotError.permissionDenied(call.name).toPublicJSON(),
              };
          messages = [
            ...messages,
            { role: 'tool', content: [{ type: 'tool_result', toolCallId: call.id, result }] },
          ];
        }
      }

      let output: unknown = aggregatedText;
      if (agent.outputSchema) {
        try {
          const structured = await generateObject({
            runtime: {
              registry: options.modelRuntime.registry,
              async *stream(request) {
                let structuredUsage: Usage | undefined;
                for await (const event of options.modelRuntime.stream({
                  ...request,
                  metadata: withTelemetryMetadata(request.metadata, { correlation, parentSpan: runSpan }),
                })) {
                  if (event.type === 'usage.updated') structuredUsage = event.usage;
                  if (event.type === 'model.completed') structuredUsage = event.usage ?? structuredUsage;
                  yield event;
                }
                usage = addUsage(usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, structuredUsage);
              },
            },
            model: modelRef,
            schema: agent.outputSchema,
            signal: combinedController.signal,
            messages: [...messages, { role: 'assistant', content: [{ type: 'text', text: aggregatedText }] }],
          });
          output = structured.object;
        } catch (error) {
          throw CopilotError.agentOutputInvalid(
            `Agent "${agent.id}" produced output that does not match its declared output schema.`,
            { agentId: agent.id, cause: error instanceof Error ? error.message : String(error) },
          );
        }
      }

      emit(agentRunCompletedEvent(correlation, sequencer, agent.id, runId));
      endSpanOk(runSpan);
      recordRun(telemetry, { kind: 'agent', phase: 'completed', correlation, label: agent.id, usage, latencyMs: Date.now() - startedAt });
      telemetry.recordMetric({ name: METRICS.agentIterations, kind: 'histogram', value: iterations, attributes: { 'copilot.agent_id': agent.id } });
      return {
        runId,
        agentId: agent.id,
        status: 'completed',
        output: output as TOutput,
        iterations,
        toolCallCount: budget.toolCalls,
      };
    } catch (error) {
      if (externalSignal?.aborted) {
        emit(agentRunCancelledEvent(correlation, sequencer, agent.id, runId));
        runSpan.end('cancelled', error);
        recordRun(telemetry, { kind: 'agent', phase: 'cancelled', correlation, label: agent.id, usage, latencyMs: Date.now() - startedAt });
        return { runId, agentId: agent.id, status: 'cancelled', iterations: 0, toolCallCount: budget.toolCalls };
      }
      const copilotError = timedOut
        ? CopilotError.agentTimeout(`Agent "${agent.id}" exceeded its ${limits.timeoutMs}ms timeout.`)
        : CopilotError.isCopilotError(error)
          ? error
          : CopilotError.agentExecutionError(error instanceof Error ? error.message : String(error));
      emit(agentRunFailedEvent(correlation, sequencer, agent.id, runId, copilotError.toPublicJSON()));
      endSpanError(runSpan, copilotError);
      recordRun(telemetry, { kind: 'agent', phase: 'failed', correlation, label: agent.id, usage, latencyMs: Date.now() - startedAt, error: copilotError.toPublicJSON() });
      return {
        runId,
        agentId: agent.id,
        status: 'failed',
        error: copilotError.toPublicJSON(),
        iterations: 0,
        toolCallCount: budget.toolCalls,
      };
    } finally {
      clearTimeout(timeoutHandle);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  return { run: runAgent };
}
