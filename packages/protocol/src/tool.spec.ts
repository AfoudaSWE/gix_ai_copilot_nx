import { describe, expect, it } from 'vitest';
import { createEventId, createRunId, createThreadId, createToolCallId } from './ids.js';
import { PROTOCOL_VERSION } from './version.js';
import { parseEvent, serializeEvent } from './serialization.js';
import type { CopilotEventBase } from './events.js';
import type { ContentPart } from './message.js';
import type { ToolResult } from './tool.js';

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

describe('tool protocol events', () => {
  it('round-trips a tool.requested event through serialize/parse', () => {
    const toolCallId = createToolCallId();
    const event = {
      ...baseEnvelope(2),
      type: 'tool.requested' as const,
      toolCallId,
      name: 'applications.getStatus',
      arguments: { applicationId: 'APP-1024' },
      source: 'native' as const,
    };
    const parsed = parseEvent(JSON.parse(serializeEvent(event)));
    expect(parsed.kind).toBe('known');
    if (parsed.kind === 'known' && parsed.event.type === 'tool.requested') {
      expect(parsed.event.toolCallId).toBe(toolCallId);
      expect(parsed.event.arguments).toEqual({ applicationId: 'APP-1024' });
      expect(parsed.event.source).toBe('native');
    }
  });

  it('round-trips tool.started, tool.completed, and tool.failed events', () => {
    const toolCallId = createToolCallId();

    const started = parseEvent({
      ...baseEnvelope(3),
      type: 'tool.started',
      toolCallId,
      name: 'math.add',
    });
    expect(started.kind).toBe('known');

    const completed = parseEvent({
      ...baseEnvelope(4),
      type: 'tool.completed',
      toolCallId,
      name: 'math.add',
      result: { result: 4 },
    });
    expect(completed.kind).toBe('known');

    const failed = parseEvent({
      ...baseEnvelope(5),
      type: 'tool.failed',
      toolCallId,
      name: 'math.add',
      error: { code: 'TOOL_EXECUTION_ERROR', message: 'boom', retryable: false },
    });
    expect(failed.kind).toBe('known');
  });

  it('rejects a tool.requested event with a non-object arguments field', () => {
    const parsed = parseEvent({
      ...baseEnvelope(2),
      type: 'tool.requested',
      toolCallId: createToolCallId(),
      name: 'applications.getStatus',
      arguments: 'not-an-object',
      source: 'native',
    });
    expect(parsed.kind).toBe('invalid');
  });

  it('an older client treats an unknown future tool event type as forward-compatible, not fatal', () => {
    const parsed = parseEvent({ ...baseEnvelope(6), type: 'tool.something-from-the-future' });
    expect(parsed.kind).toBe('unknown');
  });
});

describe('ContentPart tool variants', () => {
  it('accepts a tool_call content part on an assistant message', () => {
    const part: ContentPart = {
      type: 'tool_call',
      toolCallId: createToolCallId(),
      name: 'applications.getStatus',
      arguments: { applicationId: 'APP-1024' },
    };
    expect(part.type).toBe('tool_call');
  });

  it('accepts a tool_result content part carrying a success or error ToolResult', () => {
    const toolCallId = createToolCallId();
    const success: ToolResult = { status: 'success', toolCallId, data: { status: 'PENDING' } };
    const failure: ToolResult = {
      status: 'error',
      toolCallId,
      error: { code: 'TOOL_EXECUTION_ERROR', message: 'boom', retryable: false },
    };
    const successPart: ContentPart = { type: 'tool_result', toolCallId, result: success };
    const failurePart: ContentPart = { type: 'tool_result', toolCallId, result: failure };
    expect(successPart.result.status).toBe('success');
    expect(failurePart.result.status).toBe('error');
  });
});

describe('createToolCallId', () => {
  it('produces distinct ids', () => {
    expect(createToolCallId()).not.toBe(createToolCallId());
  });
});
