import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, createEventId, createRunId, createThreadId } from '@gixcopilot/protocol';
import type { RunStartedEvent } from '@gixcopilot/protocol';
import { formatSseComment, formatSseFrame } from './sse.js';

describe('formatSseFrame', () => {
  it('emits id, event, and data lines terminated by a blank line', () => {
    const event: RunStartedEvent = {
      id: createEventId(),
      runId: createRunId(),
      threadId: createThreadId(),
      sequence: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
      protocolVersion: PROTOCOL_VERSION,
      type: 'run.started',
    };

    const frame = formatSseFrame(event);

    expect(frame.startsWith(`id: ${event.id}\n`)).toBe(true);
    expect(frame).toContain('event: run.started\n');
    expect(frame).toContain(`data: ${JSON.stringify(event)}\n`);
    expect(frame.endsWith('\n\n')).toBe(true);
  });
});

describe('formatSseComment', () => {
  it('prefixes the message with a colon and ends with a blank line', () => {
    expect(formatSseComment('hello')).toBe(': hello\n\n');
  });
});
