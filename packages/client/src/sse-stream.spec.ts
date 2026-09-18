import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, createEventId, createRunId, createThreadId } from '@aicopilot/protocol';
import { parseSseStream } from './sse-stream.js';

function streamFromChunks(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
      } else {
        controller.close();
      }
    },
  });
}

function envelope(sequence: number) {
  return {
    id: createEventId(),
    runId: createRunId(),
    threadId: createThreadId(),
    sequence,
    timestamp: new Date().toISOString(),
    protocolVersion: PROTOCOL_VERSION,
  };
}

describe('parseSseStream', () => {
  it('parses a single frame even when split across multiple chunk boundaries', async () => {
    const event = { ...envelope(1), type: 'run.started' as const };
    const frame = `id: ${event.id}\nevent: run.started\ndata: ${JSON.stringify(event)}\n\n`;
    const stream = streamFromChunks([frame.slice(0, 10), frame.slice(10)]);

    const collected = [];
    for await (const parsed of parseSseStream(stream)) {
      collected.push(parsed);
    }
    expect(collected).toEqual([event]);
  });

  it('parses multiple frames delivered in a single chunk', async () => {
    const first = { ...envelope(1), type: 'run.started' as const };
    const second = { ...envelope(2), type: 'run.cancelled' as const };
    const frames = `data: ${JSON.stringify(first)}\n\ndata: ${JSON.stringify(second)}\n\n`;
    const stream = streamFromChunks([frames]);

    const collected = [];
    for await (const parsed of parseSseStream(stream)) {
      collected.push(parsed);
    }
    expect(collected).toEqual([first, second]);
  });

  it('ignores comment lines and forward-compatible unknown event types', async () => {
    const unknown = { ...envelope(1), type: 'tool.invoked', extra: true };
    const known = { ...envelope(2), type: 'run.cancelled' as const };
    const frames = `: keep-alive\n\ndata: ${JSON.stringify(unknown)}\n\ndata: ${JSON.stringify(known)}\n\n`;
    const stream = streamFromChunks([frames]);

    const collected = [];
    for await (const parsed of parseSseStream(stream)) {
      collected.push(parsed);
    }
    expect(collected).toEqual([known]);
  });

  it('throws when a recognized event type fails schema validation', async () => {
    const malformed = { ...envelope(1), type: 'run.completed' }; // missing required `usage`
    const stream = streamFromChunks([`data: ${JSON.stringify(malformed)}\n\n`]);

    await expect(async () => {
      for await (const _parsed of parseSseStream(stream)) {
        // draining is enough to trigger the throw
      }
    }).rejects.toThrow();
  });
});
