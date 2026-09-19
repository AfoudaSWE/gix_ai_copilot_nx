import { describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, createEventId, createRunId, createThreadId } from '@gixcopilot/protocol';
import type { CopilotEvent } from '@gixcopilot/protocol';
import { createCopilotClient } from './client.js';
import type { CopilotTransport, TransportRunRequest } from './transport.js';

function fakeEvent(type: CopilotEvent['type'], sequence: number): CopilotEvent {
  return {
    id: createEventId(),
    runId: createRunId(),
    threadId: createThreadId(),
    sequence,
    timestamp: new Date().toISOString(),
    protocolVersion: PROTOCOL_VERSION,
    type,
  } as CopilotEvent;
}

function createFakeTransport(events: readonly CopilotEvent[]) {
  let capturedRequest: TransportRunRequest | undefined;
  const cancel = vi.fn(() => Promise.resolve(undefined));
  const submitToolResult = vi.fn(() => Promise.resolve(undefined));
  const decideApproval = vi.fn(() => Promise.resolve(undefined));
  const transport: CopilotTransport = {
    async *run(request) {
      await Promise.resolve();
      capturedRequest = request;
      for (const event of events) {
        if (request.signal?.aborted === true) {
          return;
        }
        yield event;
      }
    },
    cancel,
    submitToolResult,
    decideApproval,
  };
  return { transport, cancel, submitToolResult, decideApproval, getCapturedRequest: () => capturedRequest };
}

describe('createCopilotClient', () => {
  it('forwards threadId and messages to the transport', async () => {
    const { transport, getCapturedRequest } = createFakeTransport([fakeEvent('run.started', 1)]);
    const client = createCopilotClient({ baseUrl: 'http://example.invalid', transport });

    const run = client.run({
      threadId: 'thread-123',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
    for await (const _event of run.events) {
      // drain
    }

    expect(getCapturedRequest()?.threadId).toBe('thread-123');
    expect(getCapturedRequest()?.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ]);
  });

  it('yields events from the transport in order', async () => {
    const events = [fakeEvent('run.started', 1), fakeEvent('run.completed', 2)];
    const { transport } = createFakeTransport(events);
    const client = createCopilotClient({ baseUrl: 'http://example.invalid', transport });

    const run = client.run({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
    const collected: CopilotEvent[] = [];
    for await (const event of run.events) {
      collected.push(event);
    }
    expect(collected).toEqual(events);
  });

  it('cancel() aborts the signal the transport observes, stopping further events', async () => {
    const events = [
      fakeEvent('run.started', 1),
      fakeEvent('message.started', 2),
      fakeEvent('run.completed', 3),
    ];
    const { transport } = createFakeTransport(events);
    const client = createCopilotClient({ baseUrl: 'http://example.invalid', transport });

    const run = client.run({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
    const iterator = run.events[Symbol.asyncIterator]() as AsyncIterator<
      CopilotEvent,
      void,
      undefined
    >;

    const collected: CopilotEvent[] = [];
    const first = await iterator.next();
    if (!first.done) {
      collected.push(first.value);
    }
    run.cancel();

    let result = await iterator.next();
    while (!result.done) {
      collected.push(result.value);
      result = await iterator.next();
    }

    expect(collected).toEqual([events[0]]);
  });

  it('respects an externally supplied AbortSignal passed to run()', async () => {
    const events = [fakeEvent('run.started', 1), fakeEvent('run.completed', 2)];
    const { transport } = createFakeTransport(events);
    const client = createCopilotClient({ baseUrl: 'http://example.invalid', transport });

    const external = new AbortController();
    external.abort();
    const run = client.run({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      signal: external.signal,
    });

    const collected: CopilotEvent[] = [];
    for await (const event of run.events) {
      collected.push(event);
    }
    expect(collected).toEqual([]);
  });

  it('forwards tools to the transport', async () => {
    const { transport, getCapturedRequest } = createFakeTransport([fakeEvent('run.started', 1)]);
    const client = createCopilotClient({ baseUrl: 'http://example.invalid', transport });
    const tools = [
      { name: 'nav.open', description: 'x', parameters: {}, executionLocation: 'client' as const },
    ];

    const run = client.run({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      tools,
    });
    for await (const _event of run.events) {
      // drain
    }

    expect(getCapturedRequest()?.tools).toEqual(tools);
  });

  it('submitToolResult delegates to the transport', async () => {
    const { transport, submitToolResult } = createFakeTransport([]);
    const client = createCopilotClient({ baseUrl: 'http://example.invalid', transport });

    await client.submitToolResult('run-1', 'call-1', {
      status: 'success',
      toolCallId: 'call-1',
      data: {},
    });

    expect(submitToolResult).toHaveBeenCalledWith('run-1', 'call-1', {
      status: 'success',
      toolCallId: 'call-1',
      data: {},
    });
  });

  it('decideApproval delegates to the transport (Section 83)', async () => {
    const { transport, decideApproval } = createFakeTransport([]);
    const client = createCopilotClient({ baseUrl: 'http://example.invalid', transport });

    await client.decideApproval('approval-1', 'approve', 'looks fine');

    expect(decideApproval).toHaveBeenCalledWith('approval-1', 'approve', 'looks fine');
  });
});
