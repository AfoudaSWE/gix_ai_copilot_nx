import { z } from 'zod';
import type { AgentRunResult, AnyAgentDefinition } from '@gixcopilot/agents';
import { CopilotError } from '@gixcopilot/protocol';
import type { PublicCopilotError } from '@gixcopilot/protocol';
import type { ModelExecutionOptions, ModelProvider, ModelRequest, ModelStreamEvent } from '@gixcopilot/provider';
import type { RetrievalContext, RetrievalExclusionReason, RetrievalQuery, RetrievalResult, Retriever } from '@gixcopilot/rag';
import type { SecurityContext } from '@gixcopilot/security';
import type { DiagnosticEvent, ModelCallDiagnostic, RagRetrievalDiagnostic, TelemetryMode, ToolExecutionDiagnostic } from '@gixcopilot/telemetry';
import { defineTool } from '@gixcopilot/tools';
import type { AnyToolDefinition, ToolExecutionContext } from '@gixcopilot/tools';
import type { AnyWorkflowDefinition, WorkflowCheckpoint } from '@gixcopilot/workflows';
import type { SecurityFixture } from './security.js';
import { createAgentSimulation, createWorkflowSimulation } from './simulation.js';
import type { AgentSimulation } from './simulation.js';

/** Anything that carries recorded diagnostics: a telemetry session, a DevTools snapshot, or
 * an imported debug bundle's snapshot. */
export interface RecordedDiagnostics {
  readonly mode?: TelemetryMode;
  readonly events: readonly DiagnosticEvent[];
}

/**
 * - `recorded`: model responses AND tool results come from the recording.
 * - `mocked`: the caller's deterministic model; tool results from the recording.
 * - `live-model`: a real model (e.g. to compare another model/prompt); tools STILL simulated.
 * In every mode tools are simulated unless explicitly allowlisted for live execution.
 */
export type ReplayMode = 'recorded' | 'mocked' | 'live-model';

export interface LiveToolOptIn {
  /** Tool names allowed to execute for real. Everything else stays simulated. */
  readonly allow: readonly string[];
  readonly tools: readonly AnyToolDefinition[];
  /** Required: live re-execution still passes discovery and the Action Firewall (Section 165). */
  readonly security: SecurityFixture;
}

export interface ReplayOptions {
  readonly mode?: ReplayMode;
  /** Replay one run tree (a root run and its children); default is everything recorded. */
  readonly runId?: string;
  /** Required for `mocked` and `live-model`. */
  readonly models?: readonly ModelProvider[];
  readonly liveTools?: LiveToolOptIn;
}

export interface ReplayedToolCall {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  /** `recorded`: served the original result. `unrecorded`: no recording existed, nothing ran.
   * `live`: explicitly allowlisted and executed through the security stack. */
  readonly served: 'recorded' | 'unrecorded' | 'live';
}

export interface Replay {
  /** Shown next to every replay result (Section 165) - never mistaken for a real run. */
  readonly label: string;
  readonly mode: ReplayMode;
  readonly models: readonly ModelProvider[];
  readonly tools: readonly AnyToolDefinition[];
  /** Tools executed for real (only ever the allowlist), still behind the firewall. */
  readonly liveSecurity?: SecurityFixture;
  readonly toolCalls: readonly ReplayedToolCall[];
  /** Tool names the original run called, in order. */
  readonly originalToolSequence: readonly string[];
}

export class ReplayNotPossibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayNotPossibleError';
  }
}

function runTreeIds(events: readonly DiagnosticEvent[], runId: string): Set<string> {
  const ids = new Set([runId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const event of events) {
      const { runId: id, parentRunId, rootRunId } = event.correlation;
      if (id && !ids.has(id) && ((parentRunId && ids.has(parentRunId)) || (rootRunId && ids.has(rootRunId)))) {
        ids.add(id);
        grew = true;
      }
    }
  }
  return ids;
}

function inScope(events: readonly DiagnosticEvent[], runId: string | undefined): DiagnosticEvent[] {
  if (!runId) return [...events];
  const ids = runTreeIds(events, runId);
  return events.filter((event) => event.correlation.runId !== undefined && ids.has(event.correlation.runId));
}

const byTime = (a: DiagnosticEvent, b: DiagnosticEvent): number => a.timestamp.localeCompare(b.timestamp);

/** A provider that plays back one recorded provider's responses, in order (Section 66). */
function recordedProvider(id: string, calls: readonly ModelCallDiagnostic[]): ModelProvider {
  let index = 0;
  return {
    id,
    async *stream(_request: ModelRequest, execution?: ModelExecutionOptions): AsyncGenerator<ModelStreamEvent, void, undefined> {
      await Promise.resolve();
      const call = calls[index];
      index += 1;
      yield { type: 'model.started' };
      if (execution?.signal?.aborted) return;
      if (!call) {
        yield { type: 'model.failed', error: { code: 'MODEL_ERROR', message: `Replay: provider "${id}" has no recorded response #${index}.`, retryable: false } };
        return;
      }
      if (call.status === 'failed') {
        yield { type: 'model.failed', error: call.error ?? { code: 'MODEL_ERROR', message: 'Recorded model failure.', retryable: false } };
        return;
      }
      if (call.responseText) yield { type: 'content.delta', delta: call.responseText };
      for (const toolCall of call.responseToolCalls ?? []) {
        yield { type: 'tool_call.requested', toolCall: { id: toolCall.id, name: toolCall.name, arguments: (toolCall.arguments ?? {}) as Readonly<Record<string, unknown>> } };
      }
      yield { type: 'model.completed', finishReason: call.finishReason ?? ((call.responseToolCalls?.length ?? 0) > 0 ? 'tool_calls' : 'stop'), usage: call.usage };
    },
  };
}

/**
 * Builds a SAFE replay of a recorded run (Section 60-68, 186, 225). Every tool the original
 * run called is replaced by a stub that returns the recorded result - so replaying a run that
 * deleted an application or refunded a payment never deletes or refunds anything. Only tools
 * named in `liveTools.allow` may run for real, and those still go through the permission-
 * aware resolver and the Action Firewall of `liveTools.security`.
 */
export function createReplay(source: RecordedDiagnostics, options: ReplayOptions = {}): Replay {
  const mode = options.mode ?? 'recorded';
  const events = inScope(source.events, options.runId).sort(byTime);
  const modelCalls = events.filter((event): event is ModelCallDiagnostic => event.type === 'model.call');
  const executions = events.filter((event): event is ToolExecutionDiagnostic => event.type === 'tool.execution');

  let models: readonly ModelProvider[];
  if (mode === 'recorded') {
    // Without payloads there is no response text and no tool-call arguments to play back.
    const payloadless = source.mode === 'metadata-only' || source.mode === 'off' || modelCalls.some((call) => call.request === undefined);
    if (payloadless) {
      throw new ReplayNotPossibleError(`This run was recorded in "${source.mode ?? 'metadata-only'}" mode without model payloads; use mode "mocked" or "live-model".`);
    }
    const byProvider = new Map<string, ModelCallDiagnostic[]>();
    for (const call of modelCalls) byProvider.set(call.provider ?? 'test', [...(byProvider.get(call.provider ?? 'test') ?? []), call]);
    models = [...byProvider.entries()].map(([id, calls]) => recordedProvider(id, calls));
  } else {
    if (!options.models?.length) throw new ReplayNotPossibleError(`Replay mode "${mode}" needs models.`);
    models = options.models;
  }

  const toolCalls: ReplayedToolCall[] = [];
  const queues = new Map<string, ToolExecutionDiagnostic[]>();
  for (const execution of executions) queues.set(execution.name, [...(queues.get(execution.name) ?? []), execution]);
  const live = new Set(options.liveTools?.allow ?? []);
  const liveByName = new Map((options.liveTools?.tools ?? []).map((tool) => [tool.name, tool]));

  const stub = (name: string): AnyToolDefinition =>
    defineTool({
      name,
      description: `Replay stub for ${name} - returns the recorded result, never executes.`,
      input: z.looseObject({}),
      execute: (args: Readonly<Record<string, unknown>>) => {
        const recorded = queues.get(name)?.shift();
        toolCalls.push({ name, arguments: args, served: recorded ? 'recorded' : 'unrecorded' });
        if (!recorded) {
          return Promise.reject(new CopilotError('TOOL_EXECUTION_ERROR', `Replay: no recorded result for "${name}"; nothing was executed.`, { retryable: false }));
        }
        if (recorded.status === 'failed') {
          const error: PublicCopilotError = recorded.error ?? { code: 'TOOL_EXECUTION_ERROR', message: 'Recorded failure.', retryable: false };
          return Promise.reject(new CopilotError(error.code, error.message, { retryable: error.retryable }));
        }
        return Promise.resolve(recorded.result ?? { replayed: true });
      },
    });

  const liveTool = (tool: AnyToolDefinition): AnyToolDefinition => ({
    ...tool,
    execute: (args: unknown, context: ToolExecutionContext) => {
      toolCalls.push({ name: tool.name, arguments: (args ?? {}) as Readonly<Record<string, unknown>>, served: 'live' });
      return tool.execute(args, context);
    },
  });

  const names = new Set([...queues.keys(), ...live]);
  const tools = [...names].map((name) => {
    const real = liveByName.get(name);
    return live.has(name) && real ? liveTool(real) : stub(name);
  });

  return {
    label: mode === 'live-model' ? 'REPLAY (live model, simulated tools)' : 'REPLAY (simulated)',
    mode,
    models,
    tools,
    liveSecurity: live.size > 0 ? options.liveTools?.security : undefined,
    toolCalls,
    originalToolSequence: executions.map((execution) => execution.name),
  };
}

export interface AgentReplayResult {
  readonly label: string;
  readonly result: AgentRunResult;
  readonly simulation: AgentSimulation;
  readonly toolCalls: readonly ReplayedToolCall[];
  readonly originalToolSequence: readonly string[];
  readonly replayedToolSequence: readonly string[];
  readonly toolSequenceMatches: boolean;
}

/** Agent replay foundation (Section 67): the same agents, recorded dependencies. */
export async function replayAgentRun(options: {
  readonly source: RecordedDiagnostics;
  readonly agents: readonly AnyAgentDefinition[];
  readonly agent: string;
  readonly message: string;
  readonly securityContext: SecurityContext;
  readonly replay?: ReplayOptions;
}): Promise<AgentReplayResult> {
  const replay = createReplay(options.source, options.replay);
  const simulation = createAgentSimulation({ agents: options.agents, models: replay.models, tools: replay.tools, security: replay.liveSecurity });
  const result = await simulation.run(options.agent, options.message, { securityContext: options.securityContext });
  const replayedToolSequence = replay.toolCalls.map((call) => call.name);
  return {
    label: replay.label,
    result,
    simulation,
    toolCalls: replay.toolCalls,
    originalToolSequence: replay.originalToolSequence,
    replayedToolSequence,
    toolSequenceMatches: JSON.stringify(replayedToolSequence) === JSON.stringify(replay.originalToolSequence),
  };
}

/**
 * Workflow replay foundation (Section 68): consequential steps are simulated from recorded
 * results, and recorded approval outcomes are re-applied in a fresh, throwaway approval store
 * - no real approval request is ever created and no real system is mutated.
 */
export async function replayWorkflowRun(options: {
  readonly source: RecordedDiagnostics;
  readonly workflow: AnyWorkflowDefinition;
  readonly input: unknown;
  readonly securityContext: SecurityContext;
  readonly workflowRunId?: string;
}): Promise<{ readonly label: string; readonly checkpoint: WorkflowCheckpoint; readonly toolCalls: readonly ReplayedToolCall[] }> {
  const replay = createReplay(options.source, { mode: 'recorded', runId: options.workflowRunId });
  const simulation = createWorkflowSimulation({ workflows: [options.workflow], tools: replay.tools });
  const recordedDecisions = options.source.events
    .filter((event) => event.type === 'approval' && event.phase !== 'requested' && (!options.workflowRunId || event.correlation.runId === options.workflowRunId))
    .map((event) => (event.type === 'approval' ? event.phase : 'requested'));

  let checkpoint = await simulation.engine.start({ workflowId: options.workflow.id, input: options.input, securityContext: options.securityContext });
  for (const decision of recordedDecisions) {
    if (checkpoint.status !== 'waiting_for_approval') break;
    const pending = await simulation.approvals.pending(checkpoint.workflowRunId);
    const [only] = pending;
    if (!only) break;
    if (decision === 'approved') await simulation.approvals.approve(only.approvalId, 'replay:recorded-decision');
    else if (decision === 'expired') await simulation.approvals.expire(only.approvalId);
    else await simulation.approvals.reject(only.approvalId, 'replay:recorded-decision');
    checkpoint = await simulation.engine.resume(checkpoint.workflowRunId, { securityContext: options.securityContext });
  }
  return { label: 'REPLAY (simulated workflow)', checkpoint, toolCalls: replay.toolCalls };
}

/** RAG replay (Section 65): serves the recorded retrieval - clearly labeled as recorded. */
export function createRecordedRetriever(source: RecordedDiagnostics): Retriever & { readonly label: string } {
  const recorded = source.events.filter((event): event is RagRetrievalDiagnostic => event.type === 'rag.retrieval').sort(byTime);
  let index = 0;
  return {
    label: 'recorded retrieval',
    retrieve(query: RetrievalQuery, _context: RetrievalContext): Promise<RetrievalResult> {
      const retrieval = recorded[index];
      index += 1;
      if (!retrieval) return Promise.reject(new ReplayNotPossibleError('No recorded retrieval left to replay.'));
      const selected = retrieval.candidates.filter((candidate) => candidate.selected);
      return Promise.resolve({
        items: selected.map((candidate, position) => ({
          citationId: candidate.citationId ?? `S${position + 1}`,
          item: {
            chunk: { id: candidate.chunkId, content: candidate.excerpt ?? '', metadata: {} },
            score: candidate.score ?? 0,
            provenance: { sourceId: candidate.sourceId ?? 'unknown', documentId: candidate.documentId ?? 'unknown' },
          },
        })) as unknown as RetrievalResult['items'],
        citations: selected.map((candidate, position) => ({ id: candidate.citationId ?? `S${position + 1}`, sourceId: candidate.sourceId ?? 'unknown', documentId: candidate.documentId ?? 'unknown', title: candidate.title })),
        diagnostics: {
          query: retrieval.query ?? query.text,
          retrievedCount: retrieval.retrievedCount,
          authorizedCount: retrieval.authorizedCount,
          excludedCount: retrieval.excludedCount,
          rerankedCount: retrieval.rerankedCount,
          includedCount: retrieval.includedCount,
          // The recorded reason is the retriever's own exclusion code - preserved, not re-derived.
          exclusions: retrieval.candidates
            .filter((candidate) => !candidate.selected)
            .map((candidate) => ({ chunkId: candidate.chunkId, reason: (candidate.exclusionReason ?? 'BELOW_THRESHOLD') as RetrievalExclusionReason })),
        },
      });
    },
  };
}
