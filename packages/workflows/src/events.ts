import { PROTOCOL_VERSION, createEventId } from '@gixcopilot/protocol';
import type {
  CopilotEvent,
  CopilotEventBase,
  PublicCopilotError,
  RunId,
  ThreadId,
  WorkflowCheckpointSavedEvent,
  WorkflowRunCancelledEvent,
  WorkflowRunCompletedEvent,
  WorkflowRunFailedEvent,
  WorkflowRunPausedEvent,
  WorkflowRunResumedEvent,
  WorkflowRunStartedEvent,
  WorkflowStepCompletedEvent,
  WorkflowStepFailedEvent,
  WorkflowStepStartedEvent,
} from '@gixcopilot/protocol';

export interface WorkflowEventCorrelation {
  readonly runId: RunId;
  readonly threadId: ThreadId;
  readonly rootRunId?: RunId;
  readonly parentRunId?: RunId;
}

export type WorkflowEventListener = (event: CopilotEvent) => void;

function baseEnvelope(correlation: WorkflowEventCorrelation, sequence: number): CopilotEventBase {
  return {
    id: createEventId(),
    runId: correlation.runId,
    threadId: correlation.threadId,
    sequence,
    timestamp: new Date().toISOString(),
    protocolVersion: PROTOCOL_VERSION,
    ...(correlation.rootRunId !== undefined ? { rootRunId: correlation.rootRunId } : {}),
    ...(correlation.parentRunId !== undefined ? { parentRunId: correlation.parentRunId } : {}),
  };
}

export function workflowRunStartedEvent(
  correlation: WorkflowEventCorrelation,
  sequence: number,
  workflowId: string,
  workflowRunId: string,
): WorkflowRunStartedEvent {
  return { ...baseEnvelope(correlation, sequence), type: 'workflow.run.started', workflowId, workflowRunId };
}

export function workflowRunPausedEvent(
  correlation: WorkflowEventCorrelation,
  sequence: number,
  workflowId: string,
  workflowRunId: string,
  reason: 'approval' | 'checkpoint' | 'manual' | 'external-event',
  stepId?: string,
): WorkflowRunPausedEvent {
  return {
    ...baseEnvelope(correlation, sequence),
    type: 'workflow.run.paused',
    workflowId,
    workflowRunId,
    reason,
    ...(stepId !== undefined ? { stepId } : {}),
  };
}

export function workflowRunResumedEvent(
  correlation: WorkflowEventCorrelation,
  sequence: number,
  workflowId: string,
  workflowRunId: string,
): WorkflowRunResumedEvent {
  return { ...baseEnvelope(correlation, sequence), type: 'workflow.run.resumed', workflowId, workflowRunId };
}

export function workflowRunCompletedEvent(
  correlation: WorkflowEventCorrelation,
  sequence: number,
  workflowId: string,
  workflowRunId: string,
): WorkflowRunCompletedEvent {
  return { ...baseEnvelope(correlation, sequence), type: 'workflow.run.completed', workflowId, workflowRunId };
}

export function workflowRunFailedEvent(
  correlation: WorkflowEventCorrelation,
  sequence: number,
  workflowId: string,
  workflowRunId: string,
  error: PublicCopilotError,
): WorkflowRunFailedEvent {
  return { ...baseEnvelope(correlation, sequence), type: 'workflow.run.failed', workflowId, workflowRunId, error };
}

export function workflowRunCancelledEvent(
  correlation: WorkflowEventCorrelation,
  sequence: number,
  workflowId: string,
  workflowRunId: string,
): WorkflowRunCancelledEvent {
  return { ...baseEnvelope(correlation, sequence), type: 'workflow.run.cancelled', workflowId, workflowRunId };
}

export function workflowStepStartedEvent(
  correlation: WorkflowEventCorrelation,
  sequence: number,
  workflowRunId: string,
  stepId: string,
  stepType: WorkflowStepStartedEvent['stepType'],
  attempt: number,
  phase?: 'forward' | 'compensation',
): WorkflowStepStartedEvent {
  return {
    ...baseEnvelope(correlation, sequence),
    type: 'workflow.step.started',
    workflowRunId,
    stepId,
    stepType,
    attempt,
    ...(phase !== undefined ? { phase } : {}),
  };
}

export function workflowStepCompletedEvent(
  correlation: WorkflowEventCorrelation,
  sequence: number,
  workflowRunId: string,
  stepId: string,
  attempt: number,
  phase?: 'forward' | 'compensation',
): WorkflowStepCompletedEvent {
  return {
    ...baseEnvelope(correlation, sequence),
    type: 'workflow.step.completed',
    workflowRunId,
    stepId,
    attempt,
    ...(phase !== undefined ? { phase } : {}),
  };
}

export function workflowStepFailedEvent(
  correlation: WorkflowEventCorrelation,
  sequence: number,
  workflowRunId: string,
  stepId: string,
  attempt: number,
  error: PublicCopilotError,
  willRetry: boolean,
  phase?: 'forward' | 'compensation',
): WorkflowStepFailedEvent {
  return {
    ...baseEnvelope(correlation, sequence),
    type: 'workflow.step.failed',
    workflowRunId,
    stepId,
    attempt,
    error,
    willRetry,
    ...(phase !== undefined ? { phase } : {}),
  };
}

export function workflowCheckpointSavedEvent(
  correlation: WorkflowEventCorrelation,
  sequence: number,
  workflowRunId: string,
  stepId: string,
  version: number,
): WorkflowCheckpointSavedEvent {
  return { ...baseEnvelope(correlation, sequence), type: 'workflow.checkpoint.saved', workflowRunId, stepId, version };
}
