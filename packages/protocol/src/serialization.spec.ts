import { describe, expect, it } from 'vitest';
import { createEventId, createMessageId, createRunId, createThreadId } from './ids.js';
import { PROTOCOL_VERSION } from './version.js';
import { parseEvent, serializeEvent } from './serialization.js';
import type {
  CopilotEvent,
  CopilotEventBase,
  MessageStartEvent,
  RunCompletedEvent,
  RunStartedEvent,
} from './events.js';

function baseEnvelope(sequence: number): CopilotEventBase {
  return {
    id: createEventId(),
    runId: createRunId(),
    threadId: createThreadId(),
    sequence,
    timestamp: new Date().toISOString(),
    protocolVersion: PROTOCOL_VERSION,
  };
}

/** Compiles only if every CopilotEvent variant is handled - a static exhaustiveness check. */
function describeEventType(event: CopilotEvent): string {
  switch (event.type) {
    case 'run.started':
      return 'run started';
    case 'run.completed':
      return `run completed (${event.usage.totalTokens} tokens)`;
    case 'run.failed':
      return `run failed (${event.error.code})`;
    case 'run.cancelled':
      return 'run cancelled';
    case 'message.started':
      return `message started (${event.role})`;
    case 'message.delta':
      return `message delta (${event.delta.length} chars)`;
    case 'message.end':
      return `message ended (${event.content.length} parts)`;
    case 'error':
      return `error (${event.error.code})`;
    case 'tool.requested':
      return `tool requested (${event.name})`;
    case 'tool.started':
      return `tool started (${event.name})`;
    case 'tool.completed':
      return `tool completed (${event.name})`;
    case 'tool.failed':
      return `tool failed (${event.name})`;
    case 'approval.requested':
      return `approval requested (${event.approvalLevel})`;
    case 'approval.approved':
      return `approval approved (${event.approvalId})`;
    case 'approval.rejected':
      return `approval rejected (${event.approvalId})`;
    case 'approval.expired':
      return `approval expired (${event.approvalId})`;
    case 'agent.run.started':
      return `agent run started (${event.agentId})`;
    case 'agent.run.completed':
      return `agent run completed (${event.agentId})`;
    case 'agent.run.failed':
      return `agent run failed (${event.error.code})`;
    case 'agent.run.cancelled':
      return `agent run cancelled (${event.agentId})`;
    case 'agent.delegation.started':
      return `agent delegation started (${event.fromAgentId}->${event.toAgentId})`;
    case 'agent.delegation.completed':
      return `agent delegation completed (${event.status})`;
    case 'agent.handoff':
      return `agent handoff (${event.fromAgentId}->${event.toAgentId})`;
    case 'agent.routing.decided':
      return `agent routing decided (${event.selectedAgentId})`;
    case 'workflow.run.started':
      return `workflow run started (${event.workflowId})`;
    case 'workflow.run.paused':
      return `workflow run paused (${event.reason})`;
    case 'workflow.run.resumed':
      return `workflow run resumed (${event.workflowId})`;
    case 'workflow.run.completed':
      return `workflow run completed (${event.workflowId})`;
    case 'workflow.run.failed':
      return `workflow run failed (${event.error.code})`;
    case 'workflow.run.cancelled':
      return `workflow run cancelled (${event.workflowId})`;
    case 'workflow.step.started':
      return `workflow step started (${event.stepId}, attempt ${event.attempt})`;
    case 'workflow.step.completed':
      return `workflow step completed (${event.stepId})`;
    case 'workflow.step.failed':
      return `workflow step failed (${event.stepId})`;
    case 'workflow.checkpoint.saved':
      return `workflow checkpoint saved (${event.stepId}, v${event.version})`;
    default: {
      const exhaustive: never = event;
      throw new Error(`Unhandled event type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

describe('parseEvent', () => {
  it('accepts a valid run.started event', () => {
    const candidate: RunStartedEvent = { ...baseEnvelope(1), type: 'run.started' };
    const result = parseEvent(candidate);
    expect(result.kind).toBe('known');
    if (result.kind === 'known') {
      expect(describeEventType(result.event)).toBe('run started');
    }
  });

  it('accepts a valid message.started event', () => {
    const candidate: MessageStartEvent = {
      ...baseEnvelope(2),
      type: 'message.started',
      messageId: createMessageId(),
      role: 'assistant',
    };
    const result = parseEvent(candidate);
    expect(result.kind).toBe('known');
  });

  it('round-trips through serializeEvent and back', () => {
    const original: RunStartedEvent = { ...baseEnvelope(1), type: 'run.started' };
    const wire = serializeEvent(original);
    const parsed = parseEvent(JSON.parse(wire));
    expect(parsed).toEqual({ kind: 'known', event: original });
  });

  it('treats a recognized-but-invalid-payload event as invalid, not unknown', () => {
    const malformed = { ...baseEnvelope(3), type: 'message.delta', messageId: createMessageId() };
    // missing required `delta: string`
    const result = parseEvent(malformed);
    expect(result.kind).toBe('invalid');
  });

  it('treats an event with an unrecognized type as forward-compatible "unknown", not an error', () => {
    const fromNewerServer = { ...baseEnvelope(4), type: 'tool.invoked', someFutureField: 42 };
    const result = parseEvent(fromNewerServer);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.event.type).toBe('tool.invoked');
      expect(result.event.sequence).toBe(4);
    }
  });

  it('rejects an event missing required base fields', () => {
    const missingRunId = {
      id: createEventId(),
      threadId: createThreadId(),
      sequence: 1,
      timestamp: new Date().toISOString(),
      protocolVersion: PROTOCOL_VERSION,
      type: 'run.started',
    };
    const result = parseEvent(missingRunId);
    expect(result.kind).toBe('invalid');
  });

  it('rejects non-object input without throwing', () => {
    for (const input of [null, undefined, 42, 'not an event', ['array'], true]) {
      expect(() => parseEvent(input)).not.toThrow();
      expect(parseEvent(input).kind).toBe('invalid');
    }
  });

  it('rejects an event whose sequence is not a positive integer', () => {
    const candidate = { ...baseEnvelope(0), type: 'run.started' };
    const result = parseEvent(candidate);
    expect(result.kind).toBe('invalid');
  });

  it('accepts run.completed both with and without the optional Phase 2 finishReason field', () => {
    const withoutFinishReason: RunCompletedEvent = {
      ...baseEnvelope(1),
      type: 'run.completed',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
    expect(parseEvent(withoutFinishReason).kind).toBe('known');

    const withFinishReason: RunCompletedEvent = {
      ...withoutFinishReason,
      finishReason: 'stop',
    };
    const result = parseEvent(withFinishReason);
    expect(result.kind).toBe('known');
    if (result.kind === 'known' && result.event.type === 'run.completed') {
      expect(result.event.finishReason).toBe('stop');
    }
  });

  it('rejects run.completed with an unrecognized finishReason value', () => {
    const invalid = {
      ...baseEnvelope(1),
      type: 'run.completed',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      finishReason: 'not-a-real-reason',
    };
    expect(parseEvent(invalid).kind).toBe('invalid');
  });
});
