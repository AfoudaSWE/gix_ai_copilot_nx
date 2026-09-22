import { CopilotError } from '@gixcopilot/protocol';

/**
 * Runaway-execution protection (Phase 10, Section 40-45). Every limit is optional with a
 * conservative default - an agent with no declared limits still cannot loop forever, call
 * unbounded tools, or delegate without end (see the agent-architecture skill's resumability/
 * safety requirement).
 */
export interface AgentLimits {
  readonly maxIterations?: number;
  readonly maxToolCalls?: number;
  readonly maxDelegations?: number;
  /** Maximum delegation/handoff nesting depth across the whole call chain, not per-agent. */
  readonly maxDepth?: number;
  readonly timeoutMs?: number;
}

export const DEFAULT_AGENT_LIMITS: Required<AgentLimits> = {
  maxIterations: 12,
  maxToolCalls: 24,
  maxDelegations: 6,
  maxDepth: 4,
  timeoutMs: 120_000,
};

export function resolveAgentLimits(limits: AgentLimits | undefined): Required<AgentLimits> {
  return { ...DEFAULT_AGENT_LIMITS, ...limits };
}

export function assertIterationLimit(iteration: number, limit: number): void {
  if (iteration > limit) {
    throw CopilotError.agentIterationLimitExceeded(limit);
  }
}

export function assertToolCallLimit(toolCallCount: number, limit: number): void {
  if (toolCallCount > limit) {
    throw CopilotError.agentToolLimitExceeded(limit);
  }
}

export function assertDelegationLimit(delegationCount: number, limit: number): void {
  if (delegationCount > limit) {
    throw CopilotError.agentDelegationLimitExceeded(limit);
  }
}

export function assertDepthLimit(depth: number, limit: number): void {
  if (depth > limit) {
    throw CopilotError.agentDelegationDepthExceeded(limit);
  }
}
