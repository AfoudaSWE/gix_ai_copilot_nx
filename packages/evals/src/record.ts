import type { PublicCopilotError, Usage } from '@gixcopilot/protocol';
import {
  agentTree,
  contextInspections,
  delegations,
  errors,
  generativeUiRequests,
  handoffs,
  retrievals,
  routingDecisions,
  toolTimeline,
  workflows,
} from '@gixcopilot/devtools';
import type { AgentNode, DevToolsSession } from '@gixcopilot/devtools';
import type { CostEstimator } from '@gixcopilot/telemetry';
import type { EvalDataset, EvalOutcome, ExecutionRecord } from './types.js';

/** What a target reports back; everything else is read from the recorded diagnostics. */
export interface TargetResult {
  readonly answer?: string;
  readonly output?: unknown;
  readonly status?: 'completed' | 'failed' | 'cancelled';
  /** Explicit outcome when the target knows it (e.g. a clarification UI); otherwise derived. */
  readonly outcome?: EvalOutcome;
  readonly error?: PublicCopilotError;
}

const ZERO: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

function add(a: Usage, b: Usage | undefined): Usage {
  return b ? { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, totalTokens: a.totalTokens + b.totalTokens } : a;
}

function flattenAgents(nodes: readonly AgentNode[], depth = 0): (AgentNode & { depth: number })[] {
  return nodes.flatMap((node) => [{ ...node, depth }, ...flattenAgents(node.children, depth + 1)]);
}

/** Derives the structured outcome from what the runtime recorded (Section 97, 107). */
export function deriveOutcome(record: Pick<ExecutionRecord, 'status' | 'security' | 'approvals' | 'tools' | 'workflows' | 'answer'>): EvalOutcome {
  if (record.status === 'failed' || record.status === 'cancelled') return 'failed';
  const approved = new Set(record.approvals.filter((approval) => approval.status === 'approved').map((approval) => approval.action));
  const waiting =
    record.workflows.some((workflow) => workflow.status === 'paused') ||
    record.security.some((decision) => decision.decision === 'approval' && !approved.has(decision.action));
  if (waiting) return 'approval-required';
  if (record.security.some((decision) => decision.decision === 'deny')) return 'denied';
  if (record.answer?.trim().endsWith('?')) return 'clarification-required';
  return 'success';
}

/**
 * Builds one case's execution record from the diagnostics the runtime recorded while the
 * target ran (Section 223) - the same projection DevTools shows, so an eval failure and a
 * DevTools inspection always describe the same facts.
 */
export function buildExecutionRecord(options: {
  readonly session: DevToolsSession;
  readonly caseId: string;
  readonly repetition: number;
  readonly target: TargetResult;
  readonly latencyMs: number;
  readonly costEstimator?: CostEstimator;
}): ExecutionRecord {
  const { session, target } = options;
  const tools = toolTimeline(session);
  const retrieval = retrievals(session);
  const agentNodes = flattenAgents(agentTree(session));
  const context = contextInspections(session).at(-1);

  const usage = session.runs.reduce<Usage>((total, run) => add(total, run.usage), ZERO);
  const usageByAgent: Record<string, Usage> = {};
  for (const node of agentNodes) usageByAgent[node.agentId] = add(usageByAgent[node.agentId] ?? ZERO, node.usage);
  const firstModel = session.modelCalls[0];
  const primaryModel = session.modelCalls.find((call) => call.model) ?? firstModel;

  const partial = {
    status: target.status ?? (target.error ? 'failed' : 'completed'),
    answer: target.answer,
    security: session.security.map((decision) => ({ action: decision.action, toolCallId: decision.toolCallId, decision: decision.decision, reasonCode: decision.reasonCode, approvalLevel: decision.approvalLevel })),
    approvals: session.approvals.map((approval) => ({ approvalId: approval.approvalId, action: approval.action, status: approval.status, decidedBy: approval.decidedBy })),
    tools: tools.map((entry) => ({
      toolCallId: entry.toolCallId,
      name: entry.name,
      status: entry.status,
      executed: entry.phases.some((phase) => phase.phase === 'execution'),
      arguments: entry.arguments,
      result: entry.result,
      securityDecision: entry.securityDecision,
      reasonCode: entry.securityReasonCode,
      errorCode: entry.error?.code,
    })),
    workflows: workflows(session).map((workflow) => ({
      workflowId: workflow.workflowId,
      status: workflow.status,
      completedSteps: workflow.steps.filter((step) => step.status === 'completed').map((step) => step.stepId),
      approvals: workflow.approvals.length,
    })),
  } as const;

  return {
    caseId: options.caseId,
    repetition: options.repetition,
    ...partial,
    outcome: target.outcome ?? deriveOutcome(partial),
    output: target.output,
    error: target.error,
    runIds: session.runs.map((run) => run.runId),
    traceIds: [...new Set(session.spans.map((span) => span.traceId))],
    toolRequests: session.modelCalls.flatMap((call) => call.toolCallsRequested).filter((name) => !name.startsWith('agent.')),
    retrievedSources: retrieval.flatMap((entry) =>
      entry.candidates.filter((candidate) => candidate.selected).map((candidate) => ({ sourceId: candidate.sourceId ?? 'unknown', chunkId: candidate.chunkId, score: candidate.score, citationId: candidate.citationId, excerpt: candidate.excerpt })),
    ),
    excludedSources: retrieval.flatMap((entry) =>
      entry.candidates.filter((candidate) => !candidate.selected).map((candidate) => ({ sourceId: candidate.sourceId, chunkId: candidate.chunkId, reason: candidate.exclusionReason })),
    ),
    citations: retrieval.flatMap((entry) => entry.candidates.flatMap((candidate) => (candidate.citationId && candidate.selected ? [candidate.citationId] : []))),
    memory: session.memory.map((operation) => ({ operation: operation.operation, ownerType: operation.ownerType, ownerId: operation.ownerId, outcome: operation.outcome, resultCount: operation.resultCount })),
    agents: agentNodes.map((node) => ({ agentId: node.agentId, agentRunId: node.agentRunId, parentRunId: node.parentRunId, depth: node.depth, via: node.selection?.via ?? 'root', visibleTools: node.visibleTools })),
    routing: routingDecisions(session).map((decision) => ({ selectedAgentId: decision.selectedAgentId, router: decision.router, reasonCode: decision.reasonCode })),
    delegations: delegations(session).map((record) => ({ from: record.fromAgentId, to: record.toAgentId, status: record.status })),
    handoffs: handoffs(session).map((record) => ({ from: record.fromAgentId, to: record.toAgentId, reason: record.reason })),
    context: context
      ? { included: context.included.map((item) => item.name), excluded: context.excluded.map((item) => ({ name: item.name, reason: item.reason })), usedTokens: context.usedTokens, budgetTokens: context.budgetTokens }
      : undefined,
    generativeUi: generativeUiRequests(session).map((request) => ({ component: request.component, props: request.props, status: request.status })),
    modelCalls: session.modelCalls.map((call) => ({ provider: call.provider, model: call.model, usage: call.usage, latencyMs: call.latencyMs, timeToFirstChunkMs: call.timeToFirstChunkMs, status: call.status, errorCode: call.error?.code })),
    usage,
    usageByAgent,
    cost: options.costEstimator?.estimate(usage, { provider: primaryModel?.provider, model: primaryModel?.model }),
    latencyMs: options.latencyMs,
    timeToFirstTokenMs: firstModel?.timeToFirstChunkMs,
    errors: errors(session).map((error) => ({ source: error.source, code: error.code })),
  };
}

/** Validates and freezes a dataset (Section 89): unique case ids and a version are required. */
export function defineEvalDataset<TInput>(dataset: EvalDataset<TInput>): EvalDataset<TInput> {
  if (!dataset.id) throw new Error('An eval dataset needs an id.');
  if (!dataset.version) throw new Error(`Eval dataset "${dataset.id}" needs a version - comparisons across changed datasets are not valid.`);
  const seen = new Set<string>();
  for (const evalCase of dataset.cases) {
    if (seen.has(evalCase.id)) throw new Error(`Eval dataset "${dataset.id}" has a duplicate case id "${evalCase.id}".`);
    seen.add(evalCase.id);
  }
  return Object.freeze({ ...dataset, cases: Object.freeze([...dataset.cases]) });
}
