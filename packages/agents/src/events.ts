import { PROTOCOL_VERSION, createEventId } from '@gixcopilot/protocol';
import type {
  AgentDelegationCompletedEvent,
  AgentDelegationStartedEvent,
  AgentHandoffEvent,
  AgentRoutingDecidedEvent,
  AgentRunCancelledEvent,
  AgentRunCompletedEvent,
  AgentRunFailedEvent,
  AgentRunStartedEvent,
  CopilotEvent,
  CopilotEventBase,
  PublicCopilotError,
  RunId,
  ThreadId,
} from '@gixcopilot/protocol';
import type { EventSequencer } from '@gixcopilot/core';

/** Correlation identity every agent event needs - reused across every factory below so a
 * caller building an `AgentExecutionContext` never has to repeat these five fields. */
export interface AgentEventCorrelation {
  readonly runId: RunId;
  readonly threadId: ThreadId;
  readonly rootRunId?: RunId;
  readonly parentRunId?: RunId;
}

function baseEnvelope(correlation: AgentEventCorrelation, sequencer: EventSequencer): CopilotEventBase {
  return {
    id: createEventId(),
    runId: correlation.runId,
    threadId: correlation.threadId,
    sequence: sequencer.next(),
    timestamp: new Date().toISOString(),
    protocolVersion: PROTOCOL_VERSION,
    ...(correlation.rootRunId !== undefined ? { rootRunId: correlation.rootRunId } : {}),
    ...(correlation.parentRunId !== undefined ? { parentRunId: correlation.parentRunId } : {}),
  };
}

export function agentRunStartedEvent(
  correlation: AgentEventCorrelation,
  sequencer: EventSequencer,
  agentId: string,
  agentRunId: string,
): AgentRunStartedEvent {
  return { ...baseEnvelope(correlation, sequencer), type: 'agent.run.started', agentId, agentRunId };
}

export function agentRunCompletedEvent(
  correlation: AgentEventCorrelation,
  sequencer: EventSequencer,
  agentId: string,
  agentRunId: string,
): AgentRunCompletedEvent {
  return { ...baseEnvelope(correlation, sequencer), type: 'agent.run.completed', agentId, agentRunId };
}

export function agentRunFailedEvent(
  correlation: AgentEventCorrelation,
  sequencer: EventSequencer,
  agentId: string,
  agentRunId: string,
  error: PublicCopilotError,
): AgentRunFailedEvent {
  return {
    ...baseEnvelope(correlation, sequencer),
    type: 'agent.run.failed',
    agentId,
    agentRunId,
    error,
  };
}

export function agentRunCancelledEvent(
  correlation: AgentEventCorrelation,
  sequencer: EventSequencer,
  agentId: string,
  agentRunId: string,
): AgentRunCancelledEvent {
  return { ...baseEnvelope(correlation, sequencer), type: 'agent.run.cancelled', agentId, agentRunId };
}

export function agentDelegationStartedEvent(
  correlation: AgentEventCorrelation,
  sequencer: EventSequencer,
  fromAgentId: string,
  toAgentId: string,
  delegationId: string,
  depth: number,
): AgentDelegationStartedEvent {
  return {
    ...baseEnvelope(correlation, sequencer),
    type: 'agent.delegation.started',
    fromAgentId,
    toAgentId,
    delegationId,
    depth,
  };
}

export function agentDelegationCompletedEvent(
  correlation: AgentEventCorrelation,
  sequencer: EventSequencer,
  fromAgentId: string,
  toAgentId: string,
  delegationId: string,
  status: 'completed' | 'failed',
  error?: PublicCopilotError,
): AgentDelegationCompletedEvent {
  return {
    ...baseEnvelope(correlation, sequencer),
    type: 'agent.delegation.completed',
    fromAgentId,
    toAgentId,
    delegationId,
    status,
    ...(error !== undefined ? { error } : {}),
  };
}

export function agentHandoffEvent(
  correlation: AgentEventCorrelation,
  sequencer: EventSequencer,
  fromAgentId: string,
  toAgentId: string,
  reason: string,
): AgentHandoffEvent {
  return { ...baseEnvelope(correlation, sequencer), type: 'agent.handoff', fromAgentId, toAgentId, reason };
}

export function agentRoutingDecidedEvent(
  correlation: AgentEventCorrelation,
  sequencer: EventSequencer,
  router: 'deterministic' | 'model',
  selectedAgentId: string,
  candidateAgentIds: readonly string[],
  reasonCode?: string,
): AgentRoutingDecidedEvent {
  return {
    ...baseEnvelope(correlation, sequencer),
    type: 'agent.routing.decided',
    router,
    selectedAgentId,
    candidateAgentIds,
    ...(reasonCode !== undefined ? { reasonCode } : {}),
  };
}

export type AgentEventListener = (event: CopilotEvent) => void;
