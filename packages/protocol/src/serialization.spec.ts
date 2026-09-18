import { describe, expect, it } from 'vitest';
import { createEventId, createMessageId, createRunId, createThreadId } from './ids.js';
import { PROTOCOL_VERSION } from './version.js';
import { parseEvent, serializeEvent } from './serialization.js';
import type {
  CopilotEvent,
  CopilotEventBase,
  MessageStartEvent,
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
});
