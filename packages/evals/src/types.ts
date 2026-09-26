import type { PublicCopilotError, Usage } from '@gixcopilot/protocol';
import type { CostEstimate, TelemetryMode } from '@gixcopilot/telemetry';

/** Structured outcomes (Section 97) - never a free-text judgment. */
export type EvalOutcome = 'success' | 'denied' | 'approval-required' | 'clarification-required' | 'failed';

/** A schema-like validator (e.g. a Zod schema) - kept structural so the eval core never
 * depends on a particular validation library. */
export interface SchemaLike {
  safeParse(value: unknown): { readonly success: boolean };
}

export interface EvalExpectations {
  readonly outcome?: EvalOutcome;
  // Tools (Section 91-92, 100-101)
  readonly tools?: readonly string[];
  readonly forbiddenTools?: readonly string[];
  /** Required argument subset per tool name. */
  readonly toolArguments?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly toolOrder?: readonly string[];
  // Knowledge (Section 93-94, 103-106)
  readonly sources?: readonly string[];
  readonly forbiddenSources?: readonly string[];
  /** Text that must never appear in the answer (e.g. a restricted document's contents). */
  readonly forbiddenContent?: readonly string[];
  readonly requireCitations?: boolean;
  // Agents (Section 95-96, 109-111)
  readonly agent?: string;
  readonly forbiddenAgents?: readonly string[];
  readonly delegations?: readonly string[];
  readonly handoff?: { readonly from: string; readonly to: string };
  readonly maxAgentDepth?: number;
  // Answer
  readonly answerIncludes?: readonly string[];
  readonly answerExcludes?: readonly string[];
  // Structured output (Section 108)
  readonly schema?: SchemaLike;
  readonly fields?: Readonly<Record<string, unknown>>;
  // Context (Section 115)
  readonly context?: { readonly include?: readonly string[]; readonly exclude?: readonly string[]; readonly maxTokens?: number };
  // Memory (Section 114)
  readonly memory?: {
    /** Only these user ids' memory may be touched (cross-user access is a security failure). */
    readonly allowedOwners?: readonly string[];
    readonly mustRecall?: boolean;
    readonly mustNotLeak?: readonly string[];
  };
  // Workflow (Section 113)
  readonly workflow?: { readonly status?: string; readonly path?: readonly string[]; readonly approvals?: number };
  // Planner (Section 112)
  readonly plan?: { readonly knownTools?: readonly string[]; readonly knownAgents?: readonly string[]; readonly forbiddenTools?: readonly string[]; readonly maxSteps?: number };
  // Generative UI (Section 116)
  readonly generativeUi?: { readonly component?: string; readonly allowedComponents?: readonly string[] };
  // Performance budgets (Section 117-119)
  readonly maxLatencyMs?: number;
  readonly maxTokens?: number;
  readonly maxCost?: number;
}

/** One case (Section 90). `input` is whatever the target understands, e.g. `{ message }`. */
export interface EvalCase<TInput = unknown> {
  readonly id: string;
  readonly input: TInput;
  readonly expected?: EvalExpectations;
  readonly tags?: readonly string[];
  /** Marks an adversarial case whose security evaluators are hard gates (Section 132). */
  readonly adversarial?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** A versioned dataset (Section 89, ai-evals skill: a changed dataset breaks comparability). */
export interface EvalDataset<TInput = unknown> {
  readonly id: string;
  readonly version: string;
  readonly description?: string;
  readonly cases: readonly EvalCase<TInput>[];
}

/** What the evaluators see: everything the run did, derived from recorded diagnostics. */
export interface ExecutionRecord {
  readonly caseId: string;
  readonly repetition: number;
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly outcome: EvalOutcome;
  readonly answer?: string;
  readonly output?: unknown;
  readonly error?: PublicCopilotError;
  readonly runIds: readonly string[];
  readonly traceIds: readonly string[];
  /** Tools the MODEL asked for, whether or not they ran - "attempted". */
  readonly toolRequests: readonly string[];
  readonly tools: readonly {
    readonly toolCallId: string;
    readonly name: string;
    readonly status: 'succeeded' | 'failed';
    readonly executed: boolean;
    readonly arguments?: unknown;
    readonly result?: unknown;
    readonly securityDecision?: 'allow' | 'deny' | 'approval';
    readonly reasonCode?: string;
    readonly errorCode?: string;
  }[];
  readonly security: readonly { readonly action: string; readonly toolCallId?: string; readonly decision: 'allow' | 'deny' | 'approval'; readonly reasonCode?: string; readonly approvalLevel?: string }[];
  readonly approvals: readonly { readonly approvalId: string; readonly action: string; readonly status: string; readonly decidedBy?: string }[];
  readonly retrievedSources: readonly { readonly sourceId: string; readonly chunkId: string; readonly score?: number; readonly citationId?: string; readonly excerpt?: string }[];
  readonly excludedSources: readonly { readonly sourceId?: string; readonly chunkId: string; readonly reason?: string }[];
  readonly citations: readonly string[];
  readonly memory: readonly { readonly operation: string; readonly ownerType?: string; readonly ownerId?: string; readonly outcome: string; readonly resultCount?: number }[];
  readonly agents: readonly { readonly agentId: string; readonly agentRunId: string; readonly parentRunId?: string; readonly depth: number; readonly via: string; readonly visibleTools: readonly string[] }[];
  readonly routing: readonly { readonly selectedAgentId: string; readonly router: string; readonly reasonCode?: string }[];
  readonly delegations: readonly { readonly from: string; readonly to: string; readonly status: string }[];
  readonly handoffs: readonly { readonly from: string; readonly to: string; readonly reason: string }[];
  readonly workflows: readonly { readonly workflowId: string; readonly status: string; readonly completedSteps: readonly string[]; readonly approvals: number }[];
  readonly context?: { readonly included: readonly string[]; readonly excluded: readonly { readonly name: string; readonly reason: string }[]; readonly usedTokens: number; readonly budgetTokens?: number };
  readonly generativeUi: readonly { readonly component: string; readonly props?: unknown; readonly status: string }[];
  readonly modelCalls: readonly { readonly provider?: string; readonly model?: string; readonly usage?: Usage; readonly latencyMs: number; readonly timeToFirstChunkMs?: number; readonly status: string; readonly errorCode?: string }[];
  readonly usage: Usage;
  readonly usageByAgent: Readonly<Record<string, Usage>>;
  readonly cost?: CostEstimate;
  readonly latencyMs: number;
  readonly timeToFirstTokenMs?: number;
  readonly errors: readonly { readonly source: string; readonly code: string }[];
}

/** Evaluator output (Section 99) - a metric with evidence, never one magic score. */
export interface EvaluationResult {
  readonly evaluatorId: string;
  readonly metric: string;
  /** Normalized 0..1 where higher is better, unless `unit` says otherwise. */
  readonly value: number;
  readonly unit?: 'ratio' | 'ms' | 'tokens' | 'currency' | 'count';
  readonly passed?: boolean;
  readonly threshold?: number;
  readonly evidence: readonly string[];
  readonly details?: unknown;
  /** Security results are hard gates: one failure fails the gate (Section 132). */
  readonly security?: boolean;
  /** Model-judged or otherwise non-exact - reported as a signal, not ground truth. */
  readonly heuristic?: boolean;
  readonly skipped?: boolean;
}

export interface EvaluationContext {
  readonly evalCase: EvalCase;
  readonly record: ExecutionRecord;
  readonly dataset: EvalDataset;
}

/** The evaluator contract (Section 98). */
export interface Evaluator {
  readonly id: string;
  readonly metric: string;
  readonly security?: boolean;
  readonly heuristic?: boolean;
  /** Return false to skip a case the evaluator has nothing to say about. */
  applies?(evalCase: EvalCase): boolean;
  evaluate(context: EvaluationContext): EvaluationResult | Promise<EvaluationResult>;
}

/** Everything needed to reproduce a run (Section 133, 142-148). Never secrets. */
export interface ReproducibilitySnapshot {
  readonly model?: { readonly provider?: string; readonly model?: string; readonly temperature?: number; readonly maxOutputTokens?: number; readonly structuredOutput?: string };
  readonly prompt?: { readonly id: string; readonly version: string; readonly hash?: string };
  readonly tools?: readonly { readonly name: string; readonly version?: string }[];
  readonly agents?: readonly { readonly id: string; readonly version?: string; readonly model?: string; readonly tools?: readonly string[]; readonly knowledge?: readonly string[]; readonly limits?: Readonly<Record<string, number>> }[];
  readonly workflows?: readonly { readonly id: string; readonly version: string; readonly steps?: readonly string[] }[];
  readonly rag?: { readonly retriever?: string; readonly topK?: number; readonly reranker?: string; readonly filters?: unknown; readonly embeddingModel?: string };
  readonly memory?: { readonly strategy?: string; readonly enabled?: boolean };
  readonly seed?: number | string;
  readonly custom?: Readonly<Record<string, unknown>>;
}

export interface CaseResult {
  readonly caseId: string;
  readonly repetition: number;
  readonly adversarial: boolean;
  readonly passed: boolean;
  readonly record: ExecutionRecord;
  readonly results: readonly EvaluationResult[];
  readonly securityViolations: readonly EvaluationResult[];
}

export interface MetricSummary {
  readonly metric: string;
  readonly evaluatorId: string;
  readonly cases: number;
  readonly mean: number;
  readonly min: number;
  readonly passRate?: number;
  /** Across repetitions of the same case - how non-deterministic the metric is (Section 134). */
  readonly meanStdDev?: number;
  readonly security: boolean;
  readonly heuristic: boolean;
  readonly unit: NonNullable<EvaluationResult['unit']>;
}

export interface EvalRunSummary {
  readonly cases: number;
  readonly repetitions: number;
  readonly passed: number;
  readonly failed: number;
  readonly metrics: readonly MetricSummary[];
  readonly security: {
    readonly violations: number;
    readonly unauthorizedActions: number;
    readonly forbiddenToolViolations: number;
    readonly approvalBypasses: number;
    readonly restrictedKnowledgeLeaks: number;
    readonly crossUserMemoryLeaks: number;
    readonly gate: 'PASS' | 'FAIL';
  };
  readonly latency: { readonly p50?: number; readonly p95?: number; readonly timeToFirstTokenP95?: number };
  readonly tokens: { readonly total: number; readonly averagePerCase: number };
  readonly cost?: { readonly estimate: true; readonly total: number; readonly averagePerCase: number; readonly currency: string };
  readonly errors: Readonly<Record<string, number>>;
  /** The lowest-scoring cases, so one bad case is never hidden by an average (Section 122). */
  readonly worstCases: readonly { readonly caseId: string; readonly score: number; readonly failedMetrics: readonly string[] }[];
}

/** Section 126. */
export interface EvalRun {
  readonly id: string;
  readonly label?: string;
  readonly dataset: { readonly id: string; readonly version: string; readonly caseCount: number };
  readonly snapshot: ReproducibilitySnapshot;
  readonly telemetryMode: TelemetryMode;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly results: readonly CaseResult[];
  readonly summary: EvalRunSummary;
  readonly humanLabels?: readonly HumanLabel[];
}

/** Human evaluation foundation (Section 136) - labels only, not an annotation platform. */
export type HumanLabelValue = 'correct' | 'incorrect' | 'partially-correct' | 'unsafe' | 'needs-review';

export interface HumanLabel {
  readonly caseId: string;
  readonly label: HumanLabelValue;
  readonly reviewer: string;
  readonly at: string;
  readonly note?: string;
}
